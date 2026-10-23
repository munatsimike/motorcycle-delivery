import { describe, expect, it } from 'vitest';
import { RiderOfferNotificationStatus } from '../generated/prisma/client.js';
import type { OfferPushMessage, OfferPushResult } from './fcm-offer-sender.js';
import {
  androidTtlSeconds,
  decideAfterTemporaryFailure,
  decideBeforeSend,
  OFFER_NOTICE_DISCOVERY_SQL,
} from './offer-notice.js';
import { RiderOfferNotificationService } from './rider-offer-notification.service.js';
import { RiderOfferNotificationWorker } from './rider-offer-notification.worker.js';

type Notice = {
  id: string;
  assignmentId: string;
  riderProfileId: string;
  status: string;
  attemptCount: number;
  lastFailure: string | null;
  nextAttemptAt?: Date;
  sentAt?: Date | null;
  claimedAt?: Date | null;
  skipReason?: string | null;
  assignment: {
    deliveryId: string;
    status: string;
    offerExpiresAt: Date;
    delivery: { status: string };
    riderProfile: { availability: string };
  };
};

function notice(partial: Partial<Notice> & { assignment?: Partial<Notice['assignment']> } = {}): Notice {
  const expires = new Date(Date.now() + 40_000);
  return {
    id: 'notice-1',
    assignmentId: 'assignment-1',
    riderProfileId: 'profile-1',
    status: RiderOfferNotificationStatus.SENDING,
    attemptCount: 0,
    lastFailure: null,
    assignment: {
      deliveryId: 'delivery-1',
      status: 'OFFERED',
      offerExpiresAt: expires,
      delivery: { status: 'SEARCHING' },
      riderProfile: { availability: 'AVAILABLE' },
      ...partial.assignment,
    },
    ...partial,
    assignment: {
      deliveryId: 'delivery-1',
      status: 'OFFERED',
      offerExpiresAt: expires,
      delivery: { status: 'SEARCHING' },
      riderProfile: { availability: 'AVAILABLE' },
      ...partial.assignment,
    },
  };
}

function harness(
  row: Notice,
  options: {
    configured?: boolean;
    devices?: Array<{ fcmToken: string }>;
    results?: OfferPushResult[];
  } = {},
) {
  const sent: OfferPushMessage[] = [];
  const invalidated: string[][] = [];
  const prisma = {
    async $executeRawUnsafe() {
      return 1;
    },
    async $queryRawUnsafe() {
      return [{ id: row.id }];
    },
    riderOfferNotification: {
      async findUnique() {
        return row;
      },
      async update({ data }: { data: Partial<Notice> }) {
        Object.assign(row, data);
        return row;
      },
    },
    riderPushDevice: {
      async findMany() {
        return options.devices ?? [{ fcmToken: 'device-token' }];
      },
      async updateMany({ where }: { where: { fcmToken: { in: string[] } } }) {
        invalidated.push(where.fcmToken.in);
        return { count: where.fcmToken.in.length };
      },
    },
  };
  const results = options.results ?? [{ outcome: 'accepted' as const }];
  const sender = {
    configured: () => options.configured ?? true,
    async send(message: OfferPushMessage) {
      sent.push(message);
      return results[sent.length - 1] ?? { outcome: 'temporary' as const };
    },
  };
  return {
    service: new RiderOfferNotificationService(prisma as never, sender as never),
    row,
    sent,
    invalidated,
  };
}

describe('offer notice decisions', () => {
  const now = new Date('2026-10-23T00:00:00.000Z');
  const open = {
    assignmentStatus: 'OFFERED',
    deliveryStatus: 'SEARCHING',
    availability: 'AVAILABLE',
    offerExpiresAt: new Date(now.getTime() + 40_000),
    attemptCount: 0,
    lastFailure: null,
  };

  it('caps the Android lifetime at 60 seconds', () => {
    expect(androidTtlSeconds(new Date(now.getTime() + 90_000), now)).toBe(60);
    expect(androidTtlSeconds(new Date(now.getTime() + 12_500), now)).toBe(12);
    expect(androidTtlSeconds(now, now)).toBe(0);
  });

  it('skips an offer that is no longer open or has too little time left', () => {
    expect(decideBeforeSend({ ...open, assignmentStatus: 'ACCEPTED' }, now, true)).toEqual({
      action: 'skip',
      reason: 'not_offered',
    });
    expect(decideBeforeSend({
      ...open,
      offerExpiresAt: new Date(now.getTime() + 3_000),
    }, now, true)).toEqual({ action: 'skip', reason: 'expired' });
    expect(decideBeforeSend({
      ...open,
      offerExpiresAt: new Date(now.getTime() + 1_000),
      lastFailure: 'firebase_unconfigured',
    }, now, false)).toEqual({ action: 'skip', reason: 'firebase_unconfigured' });
    expect(decideBeforeSend({ ...open, availability: 'OFFLINE' }, now, true)).toEqual({
      action: 'skip',
      reason: 'rider_offline',
    });
  });

  it('waits until expiry when Firebase is not configured and retries a temporary failure twice', () => {
    expect(decideBeforeSend(open, now, false)).toEqual({
      action: 'defer',
      nextAttemptAt: open.offerExpiresAt,
      failure: 'firebase_unconfigured',
    });
    expect(decideAfterTemporaryFailure(0, open.offerExpiresAt, now)).toMatchObject({
      action: 'defer',
      failure: 'firebase_unavailable',
    });
    expect(decideAfterTemporaryFailure(2, open.offerExpiresAt, now)).toEqual({
      action: 'skip',
      reason: 'firebase_unavailable',
    });
  });
});

describe('offer notification drain', () => {
  it('marks the row sent when Firebase accepts one device', async () => {
    const { service, row, sent } = harness(notice());
    await service.drain(new Date());
    expect(row.status).toBe(RiderOfferNotificationStatus.SENT);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.ttlSeconds).toBeLessThanOrEqual(60);
    expect(sent[0]?.assignmentId).toBe('assignment-1');
    expect(sent[0]?.deliveryId).toBe('delivery-1');
  });

  it('skips when the rider has no active device', async () => {
    const { service, row, sent } = harness(notice(), { devices: [] });
    await service.drain(new Date());
    expect(row.status).toBe(RiderOfferNotificationStatus.SKIPPED);
    expect(row.skipReason).toBe('no_device');
    expect(sent).toHaveLength(0);
  });

  it('does not call Firebase when it is unconfigured', async () => {
    const { service, row, sent } = harness(notice(), { configured: false });
    await service.drain(new Date());
    expect(row.status).toBe(RiderOfferNotificationStatus.PENDING);
    expect(row.lastFailure).toBe('firebase_unconfigured');
    expect(row.nextAttemptAt).toEqual(row.assignment.offerExpiresAt);
    expect(row.assignment.status).toBe('OFFERED');
    expect(sent).toHaveLength(0);
  });

  it('invalidates every token when none can be delivered', async () => {
    const { service, row, invalidated } = harness(notice(), {
      devices: [{ fcmToken: 'old-a' }, { fcmToken: 'old-b' }],
      results: [{ outcome: 'invalid' }, { outcome: 'invalid' }],
    });
    await service.drain(new Date());
    expect(row.status).toBe(RiderOfferNotificationStatus.SKIPPED);
    expect(row.skipReason).toBe('invalid_token');
    expect(invalidated).toEqual([['old-a', 'old-b']]);
  });

  it('keeps a successful send when another token is invalid', async () => {
    const { service, row, invalidated } = harness(notice(), {
      devices: [{ fcmToken: 'good' }, { fcmToken: 'old' }],
      results: [{ outcome: 'accepted' }, { outcome: 'invalid' }],
    });
    await service.drain(new Date());
    expect(row.status).toBe(RiderOfferNotificationStatus.SENT);
    expect(invalidated).toEqual([['old']]);
  });

  it('retries a temporary failure and stops after three attempts', async () => {
    const first = harness(notice(), { results: [{ outcome: 'temporary' }] });
    await first.service.drain(new Date());
    expect(first.row.status).toBe(RiderOfferNotificationStatus.PENDING);
    expect(first.row.attemptCount).toBe(1);
    expect(first.row.lastFailure).toBe('firebase_unavailable');

    const third = harness(notice({ attemptCount: 2 }), { results: [{ outcome: 'temporary' }] });
    await third.service.drain(new Date());
    expect(third.row.status).toBe(RiderOfferNotificationStatus.SKIPPED);
    expect(third.row.skipReason).toBe('firebase_unavailable');
    expect(third.row.assignment.status).toBe('OFFERED');
  });

  it('still sends a queued notice when discovery cannot insert', async () => {
    const calls: string[] = [];
    const row = notice();
    const prisma = {
      async $executeRawUnsafe(sql: string) {
        calls.push(sql);
        if (sql.includes('INSERT INTO rider_offer_notifications')) {
          throw new Error('notification store unavailable');
        }
        return 1;
      },
      async $queryRawUnsafe() {
        return [{ id: row.id }];
      },
      riderOfferNotification: {
        async findUnique() {
          return row;
        },
        async update({ data }: { data: Partial<Notice> }) {
          Object.assign(row, data);
          return row;
        },
      },
      riderPushDevice: {
        async findMany() {
          return [{ fcmToken: 'device-token' }];
        },
        async updateMany() {
          return { count: 0 };
        },
      },
    };
    const sender = {
      configured: () => true,
      async send() {
        return { outcome: 'accepted' as const };
      },
    };
    const service = new RiderOfferNotificationService(prisma as never, sender as never);
    await expect(service.drain(new Date())).resolves.toBe(1);
    expect(row.status).toBe(RiderOfferNotificationStatus.SENT);
    expect(calls.some((sql) => sql.includes('INSERT INTO rider_offer_notifications'))).toBe(true);
  });
});

describe('offer notification discovery', () => {
  it('limits discovery to the unexpired offer index and ignores conflicts', () => {
    expect(OFFER_NOTICE_DISCOVERY_SQL).toContain('delivery_assignments_offer_expires_at_idx');
    expect(OFFER_NOTICE_DISCOVERY_SQL).toContain('a.offer_expires_at > $1');
    expect(OFFER_NOTICE_DISCOVERY_SQL).toContain("a.status = 'OFFERED'::assignment_status");
    expect(OFFER_NOTICE_DISCOVERY_SQL).toContain("d.status = 'SEARCHING'::delivery_status");
    expect(OFFER_NOTICE_DISCOVERY_SQL).toContain('ORDER BY a.offer_expires_at');
    expect(OFFER_NOTICE_DISCOVERY_SQL).toContain('LIMIT $2');
    expect(OFFER_NOTICE_DISCOVERY_SQL).toContain('ON CONFLICT (assignment_id) DO NOTHING');
    expect(OFFER_NOTICE_DISCOVERY_SQL).not.toContain('ACCEPTED');
  });

  it('recovers one notice for a committed offer and does not insert a second', async () => {
    const now = new Date('2026-10-23T12:00:00.000Z');
    const offers = [
      { id: 'open-offer', riderProfileId: 'profile-1', status: 'OFFERED', deliveryStatus: 'SEARCHING', offerExpiresAt: new Date(now.getTime() + 30_000) },
      { id: 'expired-offer', riderProfileId: 'profile-2', status: 'OFFERED', deliveryStatus: 'SEARCHING', offerExpiresAt: new Date(now.getTime() - 1_000) },
      { id: 'accepted-offer', riderProfileId: 'profile-3', status: 'ACCEPTED', deliveryStatus: 'ASSIGNED', offerExpiresAt: new Date(now.getTime() + 30_000) },
      { id: 'closed-delivery', riderProfileId: 'profile-4', status: 'OFFERED', deliveryStatus: 'CANCELLED', offerExpiresAt: new Date(now.getTime() + 30_000) },
    ];
    const notices: Array<{ assignmentId: string }> = [];
    const statements: string[] = [];
    const prisma = {
      async $executeRawUnsafe(sql: string, at: Date, limit: number) {
        statements.push(sql);
        if (!sql.includes('INSERT INTO rider_offer_notifications')) {
          return 0;
        }
        const due = offers
          .filter((offer) => offer.offerExpiresAt > at)
          .filter((offer) => offer.status === 'OFFERED' && offer.deliveryStatus === 'SEARCHING')
          .filter((offer) => !notices.some((notice) => notice.assignmentId === offer.id))
          .sort((left, right) => left.offerExpiresAt.getTime() - right.offerExpiresAt.getTime())
          .slice(0, limit);
        for (const offer of due) {
          notices.push({ assignmentId: offer.id });
        }
        return due.length;
      },
      async $queryRawUnsafe() {
        return [];
      },
    };
    const sender = { configured: () => false, async send() { return { outcome: 'temporary' as const }; } };
    const service = new RiderOfferNotificationService(prisma as never, sender as never);
    await service.drain(now);
    await service.drain(now);
    expect(notices.map((notice) => notice.assignmentId)).toEqual(['open-offer']);
    expect(statements.filter((sql) => sql === OFFER_NOTICE_DISCOVERY_SQL)).toHaveLength(2);
  });
});

describe('offer notification worker', () => {
  it('uses its own interval and does not share the dispatch lock', async () => {
    const intervals = new Map<string, ReturnType<typeof setInterval>>();
    let drained = 0;
    const scheduler = {
      addInterval(name: string, timer: ReturnType<typeof setInterval>) {
        intervals.set(name, timer);
      },
      doesExist(_kind: string, name: string) {
        return intervals.has(name);
      },
      deleteInterval(name: string) {
        const timer = intervals.get(name);
        if (timer) {
          clearInterval(timer);
        }
        intervals.delete(name);
      },
    };
    const worker = new RiderOfferNotificationWorker({
      async drain() {
        drained += 1;
        return 0;
      },
    } as never, scheduler as never);
    await worker.run();
    expect(drained).toBe(1);
    worker.onModuleInit();
    expect(intervals.has('rider-offer-notifications')).toBe(true);
    expect(intervals.has('delivery-dispatch')).toBe(false);
    worker.onModuleDestroy();
    expect(intervals.size).toBe(0);
  });
});
