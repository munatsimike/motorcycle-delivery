import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';
import { NEARBY_RIDER_RADIUS_METRES } from './nearby-riders.query.js';

export type OpenAlert = {
  id: string;
  customerAccountId: string;
  latitude: number;
  longitude: number;
  expiresAt: Date;
  attemptCount: number;
  status: 'ACTIVE' | 'SENDING';
};

export type ClaimedAlert = {
  id: string;
  customerAccountId: string;
  latitude: number;
  longitude: number;
  expiresAt: Date;
  attemptCount: number;
};

export type SaveAlertInput = {
  customerAccountId: string;
  latitude: number;
  longitude: number;
  now: Date;
  expiresAt: Date;
};

export type RescheduleAlert = {
  id: string;
  nextAttemptAt: Date | null;
  incrementAttempt: boolean;
  failure: string | null;
};

export type RiderAvailabilityAlertStore = {
  findOpen(customerAccountId: string, now: Date): Promise<OpenAlert | null>;
  saveToken(customerAccountId: string, expoPushToken: string, now: Date): Promise<void>;
  saveOpen(input: SaveAlertInput): Promise<OpenAlert>;
  cancelOpen(customerAccountId: string): Promise<void>;
  expireDue(now: Date): Promise<void>;
  releaseStaleClaims(claimedBefore: Date, now: Date): Promise<void>;
  claimDue(now: Date, limit: number): Promise<ClaimedAlert[]>;
  tokensFor(customerAccountId: string): Promise<string[]>;
  invalidateToken(expoPushToken: string, now: Date): Promise<void>;
  isSending(id: string): Promise<boolean>;
  markNotified(id: string, now: Date): Promise<boolean>;
  reschedule(input: RescheduleAlert): Promise<void>;
  expireSending(id: string): Promise<void>;
};

type AlertSql = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;

type AlertRow = {
  id: string;
  customer_account_id: string;
  latitude: unknown;
  longitude: unknown;
  expires_at: Date;
  attempt_count: number;
  status: 'ACTIVE' | 'SENDING';
};

export class PrismaRiderAvailabilityAlertStore implements RiderAvailabilityAlertStore {
  constructor(private readonly db: AlertSql) {}

  async findOpen(customerAccountId: string, now: Date): Promise<OpenAlert | null> {
    const rows = await this.db.$queryRaw<AlertRow[]>`
      SELECT "id", "customer_account_id", "latitude", "longitude", "expires_at", "attempt_count", "status"
      FROM "rider_availability_alerts"
      WHERE "customer_account_id" = ${customerAccountId}::uuid
        AND "status" IN (
          'ACTIVE'::"rider_availability_alert_status",
          'SENDING'::"rider_availability_alert_status"
        )
        AND "expires_at" > ${now}
      ORDER BY "created_at" DESC
      LIMIT 1
    `;
    return rows[0] ? readOpenAlert(rows[0]) : null;
  }

  async saveToken(customerAccountId: string, expoPushToken: string, now: Date): Promise<void> {
    await this.db.$executeRaw`
      INSERT INTO "customer_push_devices" (
        "id", "customer_account_id", "expo_push_token", "created_at", "updated_at"
      )
      VALUES (
        ${randomUUID()}::uuid, ${customerAccountId}::uuid, ${expoPushToken}, ${now}, ${now}
      )
      ON CONFLICT ("expo_push_token") DO UPDATE
      SET "customer_account_id" = EXCLUDED."customer_account_id",
          "invalidated_at" = NULL,
          "updated_at" = EXCLUDED."updated_at"
    `;
  }

  async saveOpen(input: SaveAlertInput): Promise<OpenAlert> {
    const updated = await this.updateOpen(input);
    if (updated) {
      return updated;
    }
    try {
      return await this.insertOpen(input);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const again = await this.updateOpen(input);
      if (!again) {
        throw error;
      }
      return again;
    }
  }

  async cancelOpen(customerAccountId: string): Promise<void> {
    await this.db.$executeRaw`
      UPDATE "rider_availability_alerts"
      SET "status" = 'CANCELLED'::"rider_availability_alert_status"
      WHERE "customer_account_id" = ${customerAccountId}::uuid
        AND "status" IN (
          'ACTIVE'::"rider_availability_alert_status",
          'SENDING'::"rider_availability_alert_status"
        )
    `;
  }

  async expireDue(now: Date): Promise<void> {
    await this.db.$executeRaw`
      UPDATE "rider_availability_alerts"
      SET "status" = 'EXPIRED'::"rider_availability_alert_status"
      WHERE "status" = 'ACTIVE'::"rider_availability_alert_status"
        AND "expires_at" <= ${now}
    `;
  }

  async releaseStaleClaims(claimedBefore: Date, now: Date): Promise<void> {
    await this.db.$executeRaw`
      UPDATE "rider_availability_alerts"
      SET "status" = CASE
            WHEN "expires_at" <= ${now} THEN 'EXPIRED'::"rider_availability_alert_status"
            ELSE 'ACTIVE'::"rider_availability_alert_status"
          END,
          "claimed_at" = NULL
      WHERE "status" = 'SENDING'::"rider_availability_alert_status"
        AND "claimed_at" IS NOT NULL
        AND "claimed_at" <= ${claimedBefore}
    `;
  }

  async claimDue(now: Date, limit: number): Promise<ClaimedAlert[]> {
    const rows = await this.db.$queryRaw<AlertRow[]>`
      WITH "due" AS (
        SELECT "id"
        FROM "rider_availability_alerts"
        WHERE "status" = 'ACTIVE'::"rider_availability_alert_status"
          AND "expires_at" > ${now}
          AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= ${now})
        ORDER BY "created_at"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "rider_availability_alerts" AS alert
      SET "status" = 'SENDING'::"rider_availability_alert_status",
          "claimed_at" = ${now}
      FROM "due"
      WHERE alert."id" = "due"."id"
      RETURNING alert."id", alert."customer_account_id", alert."latitude", alert."longitude",
        alert."expires_at", alert."attempt_count", alert."status"
    `;
    return rows.map(readClaimedAlert);
  }

  async tokensFor(customerAccountId: string): Promise<string[]> {
    const rows = await this.db.$queryRaw<Array<{ expo_push_token: string }>>`
      SELECT "expo_push_token"
      FROM "customer_push_devices"
      WHERE "customer_account_id" = ${customerAccountId}::uuid
        AND "invalidated_at" IS NULL
    `;
    return rows.map((row) => row.expo_push_token);
  }

  async invalidateToken(expoPushToken: string, now: Date): Promise<void> {
    await this.db.$executeRaw`
      UPDATE "customer_push_devices"
      SET "invalidated_at" = ${now},
          "updated_at" = ${now}
      WHERE "expo_push_token" = ${expoPushToken}
        AND "invalidated_at" IS NULL
    `;
  }

  async isSending(id: string): Promise<boolean> {
    const rows = await this.db.$queryRaw<Array<{ status: string }>>`
      SELECT "status"
      FROM "rider_availability_alerts"
      WHERE "id" = ${id}::uuid
      LIMIT 1
    `;
    return rows[0]?.status === 'SENDING';
  }

  async markNotified(id: string, now: Date): Promise<boolean> {
    const count = await this.db.$executeRaw`
      UPDATE "rider_availability_alerts"
      SET "status" = 'NOTIFIED'::"rider_availability_alert_status",
          "notified_at" = ${now},
          "last_failure" = NULL
      WHERE "id" = ${id}::uuid
        AND "status" = 'SENDING'::"rider_availability_alert_status"
    `;
    return count > 0;
  }

  async reschedule(input: RescheduleAlert): Promise<void> {
    const increment = input.incrementAttempt ? 1 : 0;
    await this.db.$executeRaw`
      UPDATE "rider_availability_alerts"
      SET "status" = 'ACTIVE'::"rider_availability_alert_status",
          "claimed_at" = NULL,
          "attempt_count" = "attempt_count" + ${increment},
          "next_attempt_at" = ${input.nextAttemptAt},
          "last_failure" = ${input.failure}
      WHERE "id" = ${input.id}::uuid
        AND "status" = 'SENDING'::"rider_availability_alert_status"
    `;
  }

  async expireSending(id: string): Promise<void> {
    await this.db.$executeRaw`
      UPDATE "rider_availability_alerts"
      SET "status" = 'EXPIRED'::"rider_availability_alert_status",
          "claimed_at" = NULL
      WHERE "id" = ${id}::uuid
        AND "status" = 'SENDING'::"rider_availability_alert_status"
    `;
  }

  private async updateOpen(input: SaveAlertInput): Promise<OpenAlert | null> {
    const rows = await this.db.$queryRaw<AlertRow[]>`
      UPDATE "rider_availability_alerts"
      SET "latitude" = ${input.latitude},
          "longitude" = ${input.longitude},
          "position" = ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326)::geography
      WHERE "customer_account_id" = ${input.customerAccountId}::uuid
        AND "status" IN (
          'ACTIVE'::"rider_availability_alert_status",
          'SENDING'::"rider_availability_alert_status"
        )
        AND "expires_at" > ${input.now}
      RETURNING "id", "customer_account_id", "latitude", "longitude", "expires_at", "attempt_count", "status"
    `;
    return rows[0] ? readOpenAlert(rows[0]) : null;
  }

  private async insertOpen(input: SaveAlertInput): Promise<OpenAlert> {
    const rows = await this.db.$queryRaw<AlertRow[]>`
      INSERT INTO "rider_availability_alerts" (
        "id",
        "customer_account_id",
        "latitude",
        "longitude",
        "position",
        "radius_metres",
        "status",
        "created_at",
        "expires_at",
        "attempt_count"
      )
      VALUES (
        ${randomUUID()}::uuid,
        ${input.customerAccountId}::uuid,
        ${input.latitude},
        ${input.longitude},
        ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326)::geography,
        ${NEARBY_RIDER_RADIUS_METRES},
        'ACTIVE'::"rider_availability_alert_status",
        ${input.now},
        ${input.expiresAt},
        0
      )
      RETURNING "id", "customer_account_id", "latitude", "longitude", "expires_at", "attempt_count", "status"
    `;
    const row = rows[0];
    if (!row) {
      throw new Error('Availability alert was not saved.');
    }
    return readOpenAlert(row);
  }
}

type MemoryRow = Omit<OpenAlert, 'status'> & {
  createdAt: Date;
  claimedAt: Date | null;
  nextAttemptAt: Date | null;
  status: 'ACTIVE' | 'SENDING' | 'NOTIFIED' | 'CANCELLED' | 'EXPIRED';
};

type MemoryDevice = {
  customerAccountId: string;
  token: string;
  invalidatedAt: Date | null;
};

export function createMemoryAlertStore(): RiderAvailabilityAlertStore & {
  alerts: MemoryRow[];
  devices: MemoryDevice[];
} {
  const alerts: MemoryRow[] = [];
  const devices: MemoryDevice[] = [];

  function openFor(customerAccountId: string, now: Date): MemoryRow | undefined {
    return alerts.find((alert) => (
      alert.customerAccountId === customerAccountId
      && (alert.status === 'ACTIVE' || alert.status === 'SENDING')
      && alert.expiresAt.getTime() > now.getTime()
    ));
  }

  return {
    alerts,
    devices,
    async findOpen(customerAccountId, now) {
      const alert = openFor(customerAccountId, now);
      return alert ? copyOpen(alert) : null;
    },
    async saveToken(customerAccountId, expoPushToken, now) {
      const existing = devices.find((device) => device.token === expoPushToken);
      if (existing) {
        existing.customerAccountId = customerAccountId;
        existing.invalidatedAt = null;
        return;
      }
      devices.push({ customerAccountId, token: expoPushToken, invalidatedAt: null });
      void now;
    },
    async saveOpen(input) {
      const existing = openFor(input.customerAccountId, input.now);
      if (existing) {
        existing.latitude = input.latitude;
        existing.longitude = input.longitude;
        return copyOpen(existing);
      }
      const alert: MemoryRow = {
        id: randomUUID(),
        customerAccountId: input.customerAccountId,
        latitude: input.latitude,
        longitude: input.longitude,
        expiresAt: input.expiresAt,
        attemptCount: 0,
        status: 'ACTIVE',
        createdAt: input.now,
        claimedAt: null,
        nextAttemptAt: null,
      };
      alerts.push(alert);
      return copyOpen(alert);
    },
    async cancelOpen(customerAccountId) {
      for (const alert of alerts) {
        if (alert.customerAccountId === customerAccountId && (alert.status === 'ACTIVE' || alert.status === 'SENDING')) {
          alert.status = 'CANCELLED';
        }
      }
    },
    async expireDue(now) {
      for (const alert of alerts) {
        if (alert.status === 'ACTIVE' && alert.expiresAt.getTime() <= now.getTime()) {
          alert.status = 'EXPIRED';
        }
      }
    },
    async releaseStaleClaims(claimedBefore, now) {
      for (const alert of alerts) {
        if (alert.status === 'SENDING' && alert.claimedAt && alert.claimedAt.getTime() <= claimedBefore.getTime()) {
          alert.status = alert.expiresAt.getTime() <= now.getTime() ? 'EXPIRED' : 'ACTIVE';
          alert.claimedAt = null;
        }
      }
    },
    async claimDue(now, limit) {
      const due = alerts
        .filter((alert) => (
          alert.status === 'ACTIVE'
          && alert.expiresAt.getTime() > now.getTime()
          && (alert.nextAttemptAt === null || alert.nextAttemptAt.getTime() <= now.getTime())
        ))
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
        .slice(0, limit);
      for (const alert of due) {
        alert.status = 'SENDING';
        alert.claimedAt = now;
      }
      return due.map((alert) => ({
        id: alert.id,
        customerAccountId: alert.customerAccountId,
        latitude: alert.latitude,
        longitude: alert.longitude,
        expiresAt: alert.expiresAt,
        attemptCount: alert.attemptCount,
      }));
    },
    async tokensFor(customerAccountId) {
      return devices
        .filter((device) => device.customerAccountId === customerAccountId && device.invalidatedAt === null)
        .map((device) => device.token);
    },
    async invalidateToken(expoPushToken, now) {
      const device = devices.find((item) => item.token === expoPushToken);
      if (device) {
        device.invalidatedAt = now;
      }
    },
    async isSending(id) {
      return alerts.find((alert) => alert.id === id)?.status === 'SENDING';
    },
    async markNotified(id, now) {
      const alert = alerts.find((item) => item.id === id && item.status === 'SENDING');
      if (!alert) {
        return false;
      }
      alert.status = 'NOTIFIED';
      void now;
      return true;
    },
    async reschedule(input) {
      const alert = alerts.find((item) => item.id === input.id && item.status === 'SENDING');
      if (!alert) {
        return;
      }
      alert.status = 'ACTIVE';
      alert.claimedAt = null;
      alert.nextAttemptAt = input.nextAttemptAt;
      if (input.incrementAttempt) {
        alert.attemptCount += 1;
      }
    },
    async expireSending(id) {
      const alert = alerts.find((item) => item.id === id && item.status === 'SENDING');
      if (alert) {
        alert.status = 'EXPIRED';
        alert.claimedAt = null;
      }
    },
  };
}

function readOpenAlert(row: AlertRow): OpenAlert {
  return {
    id: row.id,
    customerAccountId: row.customer_account_id,
    latitude: readCoordinate(row.latitude),
    longitude: readCoordinate(row.longitude),
    expiresAt: row.expires_at,
    attemptCount: row.attempt_count,
    status: row.status,
  };
}

function readClaimedAlert(row: AlertRow): ClaimedAlert {
  const open = readOpenAlert(row);
  return {
    id: open.id,
    customerAccountId: open.customerAccountId,
    latitude: open.latitude,
    longitude: open.longitude,
    expiresAt: open.expiresAt,
    attemptCount: open.attemptCount,
  };
}

function copyOpen(alert: MemoryRow): OpenAlert {
  return {
    id: alert.id,
    customerAccountId: alert.customerAccountId,
    latitude: alert.latitude,
    longitude: alert.longitude,
    expiresAt: alert.expiresAt,
    attemptCount: alert.attemptCount,
    status: alert.status === 'SENDING' ? 'SENDING' : 'ACTIVE',
  };
}

function readCoordinate(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error('Availability alert is unavailable.');
  }
  return numeric;
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return false;
  }
  const code = String(error.code);
  return code === '23505' || code === 'P2002';
}
