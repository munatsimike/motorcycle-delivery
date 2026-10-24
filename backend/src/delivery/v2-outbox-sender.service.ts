import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { v2MarketplaceEnabled } from '../auth/v2-flags.js';
import { remindLateV2Deliveries } from './v2-deadline-reminder.js';
import { V2PushSender, type V2PushOutcome } from './v2-push-sender.js';
import {
  V2_NOTICE_BATCH,
  V2_NOTICE_IDLE_MS,
  V2_PUSH_TYPE,
  v2NoticeConfig,
  v2RetryAt,
  type V2NoticeConfig,
} from './v2-notice.js';

type ClaimedNotice = {
  id: string;
  eventType: string;
  deliveryId: string;
  assignmentId: string;
  riderProfileId: string | null;
  customerAccountId: string | null;
  attemptCount: number;
  claimToken: string;
};

type PushDeviceRow = {
  id: string;
  fcmToken: string;
};

type FailureReason = 'provider_timeout' | 'provider_unavailable';

// A provider acceptance followed by a crash before SENT is committed can be
// delivered again after the claim lease. Exactly-once push delivery is not guaranteed.
@Injectable()
export class V2OutboxSender {
  private readonly logger = new Logger(V2OutboxSender.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: V2PushSender,
  ) {}

  async drain(now = new Date(), limit = V2_NOTICE_BATCH): Promise<number> {
    if (!v2MarketplaceEnabled()) {
      return 0;
    }
    const timing = v2NoticeConfig();
    await this.releaseStaleClaims(now, timing.leaseMs);
    await remindLateV2Deliveries(this.prisma, now);
    const claimed = await this.claim(now, limit, timing.leaseMs);
    for (const row of claimed) {
      try {
        await this.deliver(row, now, timing);
      } catch (error) {
        const name = error instanceof Error ? error.name : 'Error';
        this.logger.error(`V2 notice failed: ${name}`);
        await this.markFailure(row, now, 'provider_unavailable', timing).catch(() => undefined);
      }
    }
    return claimed.length;
  }

  private async releaseStaleClaims(now: Date, leaseMs: number): Promise<void> {
    const staleBefore = new Date(now.getTime() - leaseMs);
    await this.prisma.$executeRawUnsafe(
      `UPDATE "v2_outbox_events"
       SET "claimed_at" = NULL,
           "claim_token" = NULL
       WHERE "status" = 'PENDING'::"v2_outbox_status"
         AND "claimed_at" IS NOT NULL
         AND "claimed_at" < $1`,
      staleBefore,
    );
  }

  private async claim(now: Date, limit: number, leaseMs: number): Promise<ClaimedNotice[]> {
    const staleBefore = new Date(now.getTime() - leaseMs);
    const rows = await this.prisma.$queryRawUnsafe<Array<ClaimedNotice>>(
      `WITH due AS (
         SELECT "id"
         FROM "v2_outbox_events"
         WHERE "status" = 'PENDING'::"v2_outbox_status"
           AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= $1)
           AND ("claimed_at" IS NULL OR "claimed_at" < $2)
         ORDER BY "created_at"
         LIMIT $3
         FOR UPDATE SKIP LOCKED
       )
       UPDATE "v2_outbox_events" AS event
       SET "claimed_at" = $1,
           "claim_token" = gen_random_uuid()
       FROM due
       WHERE event."id" = due."id"
       RETURNING event."id",
                 event."event_type" AS "eventType",
                 event."delivery_id" AS "deliveryId",
                 event."assignment_id" AS "assignmentId",
                 event."rider_profile_id" AS "riderProfileId",
                 event."customer_account_id" AS "customerAccountId",
                 event."attempt_count" AS "attemptCount",
                 event."claim_token" AS "claimToken"`,
      now,
      staleBefore,
      limit,
    );
    return rows.map((row) => ({
      ...row,
      attemptCount: Number(row.attemptCount),
    }));
  }

  private async deliver(row: ClaimedNotice, now: Date, timing: V2NoticeConfig): Promise<void> {
    if (!row.claimToken) {
      return;
    }
    const idleUntil = new Date(now.getTime() + V2_NOTICE_IDLE_MS);
    if (!this.sender.configured()) {
      await this.releaseWithoutFailure(row, idleUntil);
      return;
    }
    const devices = await this.devicesFor(row);
    if (devices.length === 0) {
      await this.releaseWithoutFailure(row, idleUntil);
      return;
    }
    const type = V2_PUSH_TYPE[row.eventType as keyof typeof V2_PUSH_TYPE];
    if (!type) {
      await this.releaseWithoutFailure(row, idleUntil);
      return;
    }
    const results = await Promise.all(devices.map(async (device) => {
      try {
        const outcome = await this.sender.send({
          token: device.fcmToken,
          type,
          deliveryId: row.deliveryId,
          assignmentId: row.assignmentId,
          audience: row.eventType === 'BID_ACCEPTED' ? 'rider' : 'customer',
        }, timing.timeoutMs);
        return { device, outcome };
      } catch (error) {
        const outcome: V2PushOutcome = error instanceof Error && error.name === 'TimeoutError'
          ? 'timeout'
          : 'temporary';
        return { device, outcome };
      }
    }));
    let accepted = false;
    let reason: FailureReason | null = null;
    for (const result of results) {
      if (result.outcome === 'accepted') {
        accepted = true;
      } else if (result.outcome === 'invalid') {
        await this.invalidate(row, result.device.id, now);
      } else if (result.outcome === 'timeout') {
        reason = 'provider_timeout';
      } else if (reason !== 'provider_timeout') {
        reason = 'provider_unavailable';
      }
    }
    if (accepted) {
      await this.markSent(row, now);
      return;
    }
    if (reason) {
      await this.markFailure(row, now, reason, timing);
      return;
    }
    await this.releaseWithoutFailure(row, idleUntil);
  }

  private async devicesFor(row: ClaimedNotice): Promise<PushDeviceRow[]> {
    if (row.eventType === 'BID_ACCEPTED') {
      if (!row.riderProfileId) {
        return [];
      }
      return this.prisma.riderPushDevice.findMany({
        where: { riderProfileId: row.riderProfileId, invalidatedAt: null },
        select: { id: true, fcmToken: true },
      });
    }
    if (!row.customerAccountId) {
      return [];
    }
    return this.prisma.customerFcmDevice.findMany({
      where: { customerAccountId: row.customerAccountId, invalidatedAt: null },
      select: { id: true, fcmToken: true },
    });
  }

  private async invalidate(row: ClaimedNotice, deviceId: string, now: Date): Promise<void> {
    if (row.eventType === 'BID_ACCEPTED') {
      await this.prisma.riderPushDevice.updateMany({
        where: { id: deviceId, riderProfileId: row.riderProfileId ?? undefined },
        data: { invalidatedAt: now },
      });
      return;
    }
    await this.prisma.customerFcmDevice.updateMany({
      where: { id: deviceId, customerAccountId: row.customerAccountId ?? undefined },
      data: { invalidatedAt: now },
    });
  }

  private async markSent(row: ClaimedNotice, now: Date): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `UPDATE "v2_outbox_events"
       SET "status" = 'SENT'::"v2_outbox_status",
           "sent_at" = $3,
           "claimed_at" = NULL,
           "claim_token" = NULL
       WHERE "id" = $1::uuid
         AND "claim_token" = $2::uuid
         AND "status" = 'PENDING'::"v2_outbox_status"`,
      row.id,
      row.claimToken,
      now,
    );
  }

  private async markFailure(
    row: ClaimedNotice,
    now: Date,
    reason: FailureReason,
    timing: V2NoticeConfig,
  ): Promise<void> {
    const exhausted = row.attemptCount + 1 >= timing.maxAttempts;
    await this.prisma.$executeRawUnsafe(
      `UPDATE "v2_outbox_events"
       SET "attempt_count" = "attempt_count" + 1,
           "last_failure" = $4,
           "last_attempt_at" = $5::timestamptz,
           "claimed_at" = NULL,
           "claim_token" = NULL,
           "next_attempt_at" = $3::timestamptz,
           "failed_at" = CASE WHEN "attempt_count" + 1 >= $6::int THEN $5::timestamptz ELSE NULL::timestamptz END,
           "status" = CASE
             WHEN "attempt_count" + 1 >= $6::int THEN 'FAILED'::"v2_outbox_status"
             ELSE "status"
           END
       WHERE "id" = $1::uuid
         AND "claim_token" = $2::uuid
         AND "status" = 'PENDING'::"v2_outbox_status"`,
      row.id,
      row.claimToken,
      exhausted ? null : v2RetryAt(row.attemptCount + 1, now),
      reason,
      now,
      timing.maxAttempts,
    );
  }

  private async releaseWithoutFailure(row: ClaimedNotice, nextAttemptAt: Date): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `UPDATE "v2_outbox_events"
       SET "claimed_at" = NULL,
           "claim_token" = NULL,
           "next_attempt_at" = $3
       WHERE "id" = $1::uuid
         AND "claim_token" = $2::uuid
         AND "status" = 'PENDING'::"v2_outbox_status"`,
      row.id,
      row.claimToken,
      nextAttemptAt,
    );
  }
}
