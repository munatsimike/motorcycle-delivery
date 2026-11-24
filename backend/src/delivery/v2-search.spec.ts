import { ConflictException } from '@nestjs/common';
import { AssignmentStatus, BidStatus, DeliveryStatus, Prisma, V2OutboxEventType } from '../generated/prisma/client.js';
import { describe, expect, it } from 'vitest';
import { opportunityDedupe } from './v2-marketplace-notice.js';
import { recordDeliveryOpportunity } from './v2-outbox.js';
import {
  V2_SEARCH_WINDOW_MS,
  offerResponseDeadline,
  offerResponseElapsed,
  expireDueV2Searches,
  expireLockedV2Search,
  restartV2Search,
  riderOpportunityExpiresAt,
  v2SearchExpiryDecision,
  v2SearchExpiresAt,
  v2SearchStartData,
} from './v2-search.js';

const START = new Date('2026-10-27T12:00:00.000Z');
const OPEN = new Date(START.getTime() + V2_SEARCH_WINDOW_MS - 1);
const CLOSED = new Date(START.getTime() + V2_SEARCH_WINDOW_MS);

type Row = {
  id: string;
  status: DeliveryStatus;
  serviceClass: 'EXPRESS' | 'FLEXIBLE' | null;
  searchGeneration: number;
  searchStartedAt: Date | null;
  offerResponseExpiresAt?: Date | null;
  nextRetryAt: Date | null;
  autoRetryCount: number;
  deliverBy: Date | null;
  pickupAddress: string;
  dropoffAddress: string;
  parcelDescription: string;
  suggestedPrice: string;
};

function row(serviceClass: 'EXPRESS' | 'FLEXIBLE', deliverBy: Date | null = null): Row {
  return {
    id: serviceClass === 'EXPRESS' ? 'express-1' : 'flexible-1',
    status: DeliveryStatus.CREATED,
    serviceClass,
    ...v2SearchStartData(START),
    deliverBy,
    pickupAddress: '12 Samora Machel Avenue',
    dropoffAddress: '4 Jason Moyo Avenue',
    parcelDescription: 'Documents',
    suggestedPrice: '9.00',
  };
}

function store(seed: Row) {
  const deliveries = [seed];
  const bids: Array<{ id: string; deliveryId: string; status: BidStatus }> = [];
  const assignments: Array<{ id: string; deliveryId: string; status: AssignmentStatus }> = [];
  const declines: Array<{ deliveryId: string; riderProfileId: string }> = [];
  const events: Array<{ previousStatus: DeliveryStatus | null; newStatus: DeliveryStatus }> = [];
  const notices: Array<{ eventType: unknown; deliveryId: unknown; dedupeKey: string }> = [];
  const seenNotices = new Set<string>();
  let onLock: (() => void) | null = null;
  const db = {
    async $queryRaw() {
      onLock?.();
      return [];
    },
    async $executeRawUnsafe(query: string, ...values: unknown[]) {
      if (!query.includes('INSERT')) {
        return 0;
      }
      const dedupeKey = String(values[5] ?? '');
      if (seenNotices.has(dedupeKey)) {
        return 0;
      }
      seenNotices.add(dedupeKey);
      notices.push({ eventType: values[0], deliveryId: values[1], dedupeKey });
      return 1;
    },
    delivery: {
      async findMany() {
        return deliveries.filter((delivery) => delivery.status === DeliveryStatus.CREATED && delivery.serviceClass != null && delivery.searchGeneration === 0);
      },
      async findUnique({ where }: { where: { id: string } }) {
        return deliveries.find((delivery) => delivery.id === where.id) ?? null;
      },
      async update({ where, data }: { where: { id: string }; data: Partial<Row> }) {
        const delivery = deliveries.find((item) => item.id === where.id);
        if (!delivery) throw new Error('missing delivery');
        Object.assign(delivery, data);
        return delivery;
      },
    },
    bid: {
      async updateMany({ where, data }: { where: { deliveryId: string; status: BidStatus }; data: { status: BidStatus } }) {
        for (const bid of bids) if (bid.deliveryId === where.deliveryId && bid.status === where.status) bid.status = data.status;
        return { count: bids.length };
      },
      async findMany({ where }: { where: { deliveryId: string; status: BidStatus } }) {
        return bids.filter((bid) => bid.deliveryId === where.deliveryId && bid.status === where.status);
      },
    },
    deliveryAssignment: {
      async findMany({ where }: { where: { deliveryId: string; status: AssignmentStatus } }) {
        return assignments.filter((assignment) => assignment.deliveryId === where.deliveryId && assignment.status === where.status);
      },
    },
    riderRequestDecline: {
      async deleteMany({ where }: { where: { deliveryId: string } }) {
        const remaining = declines.filter((item) => item.deliveryId !== where.deliveryId);
        const count = declines.length - remaining.length;
        declines.splice(0, declines.length, ...remaining);
        return { count };
      },
    },
    deliveryStatusEvent: {
      async create({ data }: { data: { previousStatus: DeliveryStatus | null; newStatus: DeliveryStatus } }) {
        events.push({ previousStatus: data.previousStatus, newStatus: data.newStatus });
        return data;
      },
    },
  };
  return {
    tx: db as unknown as Prisma.TransactionClient,
    deliveries,
    bids,
    assignments,
    declines,
    events,
    notices,
    set onLock(hook: (() => void) | null) {
      onLock = hook;
    },
  };
}

describe('one six-minute V2 search', () => {
  it('starts a 360-second window for Express and Flexible without a delivery deadline', () => {
    for (const serviceClass of ['EXPRESS', 'FLEXIBLE'] as const) {
      const started = v2SearchStartData(START);
      expect(v2SearchExpiresAt(started.searchStartedAt).getTime() - START.getTime()).toBe(360_000);
      expect(V2_SEARCH_WINDOW_MS).toBe(360_000);
      expect(started).toMatchObject({ autoRetryCount: 0, searchGeneration: 0, nextRetryAt: new Date(START.getTime() + 360_000) });
      expect(row(serviceClass).deliverBy).toBeNull();
      expect(row(serviceClass).serviceClass).toBe(serviceClass);
    }
  });

  it('expires a bid-free window once and does not start another search', async () => {
    const ctx = store(row('EXPRESS'));
    expect(await expireDueV2Searches(ctx.tx, OPEN)).toBe(0);
    expect(ctx.deliveries[0]?.status).toBe(DeliveryStatus.CREATED);

    expect(await expireDueV2Searches(ctx.tx, CLOSED)).toBe(1);
    expect(ctx.deliveries[0]).toMatchObject({
      status: DeliveryStatus.NO_RIDER_FOUND,
      searchStartedAt: START,
      nextRetryAt: null,
      deliverBy: null,
      pickupAddress: '12 Samora Machel Avenue',
      parcelDescription: 'Documents',
    });
    expect(ctx.declines).toEqual([]);
    expect(ctx.assignments).toEqual([]);
    expect(ctx.events).toEqual([{ previousStatus: DeliveryStatus.CREATED, newStatus: DeliveryStatus.NO_RIDER_FOUND }]);

    expect(await expireDueV2Searches(ctx.tx, new Date(CLOSED.getTime() + 360_000))).toBe(0);
    expect(ctx.events).toHaveLength(1);
    expect(ctx.deliveries[0]?.searchStartedAt).toEqual(START);
  });

  it('keeps the request open when a bid arrives before expiry, including after six minutes', async () => {
    const ctx = store(row('FLEXIBLE'));
    ctx.bids.push({ id: 'bid-1', deliveryId: 'flexible-1', status: BidStatus.OPEN });

    expect(await expireDueV2Searches(ctx.tx, CLOSED)).toBe(0);
    expect(ctx.deliveries[0]?.status).toBe(DeliveryStatus.CREATED);
    expect(ctx.bids[0]?.status).toBe(BidStatus.OPEN);
    expect(v2SearchExpiryDecision({
      status: DeliveryStatus.CREATED,
      serviceClass: 'FLEXIBLE',
      searchGeneration: 0,
      searchStartedAt: START,
      claimedStartedAt: START,
      openBids: 1,
      acceptedAssignments: 0,
      deliverBy: null,
      now: new Date(CLOSED.getTime() + 60_000),
    })).toBe('keep');
  });

  it('lets a bid that lands during expiration keep the request open', async () => {
    const ctx = store(row('EXPRESS'));
    ctx.onLock = () => {
      ctx.bids.push({ id: 'bid-raced', deliveryId: 'express-1', status: BidStatus.OPEN });
    };

    expect(await expireLockedV2Search(ctx.tx, 'express-1', START, CLOSED)).toBe(false);
    expect(ctx.deliveries[0]?.status).toBe(DeliveryStatus.CREATED);
    expect(ctx.events).toEqual([]);
  });

  it('ignores a stale worker after Search again moves the window', async () => {
    const ctx = store(row('FLEXIBLE'));
    const restarted = new Date(CLOSED.getTime() + 1_000);
    ctx.onLock = () => {
      ctx.deliveries[0]!.searchStartedAt = restarted;
      ctx.deliveries[0]!.nextRetryAt = v2SearchExpiresAt(restarted);
    };

    expect(await expireLockedV2Search(ctx.tx, 'flexible-1', START, new Date(restarted.getTime() + 1_000))).toBe(false);
    expect(ctx.deliveries[0]?.status).toBe(DeliveryStatus.CREATED);
    expect(ctx.deliveries[0]?.searchStartedAt).toEqual(restarted);
  });

  it('starts a fresh window on Search again and leaves a duplicate tap on that same window', async () => {
    const ctx = store(row('EXPRESS'));
    ctx.deliveries[0]!.status = DeliveryStatus.NO_RIDER_FOUND;
    ctx.deliveries[0]!.nextRetryAt = null;
    ctx.declines.push({ deliveryId: 'express-1', riderProfileId: 'rider-1' });
    ctx.bids.push({ id: 'old-bid', deliveryId: 'express-1', status: BidStatus.OPEN });
    const again = new Date(CLOSED.getTime() + 5_000);

    const first = await restartV2Search(ctx.tx, ctx.deliveries[0]!, 'customer-1', again);
    const second = await restartV2Search(ctx.tx, ctx.deliveries[0]!, 'customer-1', new Date(again.getTime() + 2_000));

    expect(first).toEqual({ deliveryId: 'express-1', status: DeliveryStatus.CREATED, searchGeneration: 0 });
    expect(second).toEqual(first);
    expect(ctx.deliveries[0]).toMatchObject({
      status: DeliveryStatus.CREATED,
      searchStartedAt: again,
      nextRetryAt: v2SearchExpiresAt(again),
      autoRetryCount: 0,
      searchGeneration: 0,
      deliverBy: null,
      pickupAddress: '12 Samora Machel Avenue',
      dropoffAddress: '4 Jason Moyo Avenue',
      parcelDescription: 'Documents',
      suggestedPrice: '9.00',
      serviceClass: 'EXPRESS',
    });
    expect(ctx.declines).toEqual([]);
    expect(ctx.bids[0]?.status).toBe(BidStatus.EXPIRED);
    expect(ctx.assignments).toEqual([]);
    expect(ctx.events).toEqual([{ previousStatus: DeliveryStatus.NO_RIDER_FOUND, newStatus: DeliveryStatus.CREATED }]);
    expect(ctx.notices).toEqual([{
      eventType: V2OutboxEventType.RIDER_OPPORTUNITY,
      deliveryId: 'express-1',
      dedupeKey: opportunityDedupe('express-1', again),
    }]);
  });

  it('records one opportunity for the first search and another only when Search again opens a new window', async () => {
    const ctx = store(row('EXPRESS'));
    await restartV2Search(ctx.tx, ctx.deliveries[0]!, 'customer-1', START);
    await recordDeliveryOpportunity(ctx.tx, { deliveryId: 'express-1', openedAt: START });
    await recordDeliveryOpportunity(ctx.tx, { deliveryId: 'express-1', openedAt: START });
    expect(ctx.notices).toEqual([{
      eventType: V2OutboxEventType.RIDER_OPPORTUNITY,
      deliveryId: 'express-1',
      dedupeKey: opportunityDedupe('express-1', START),
    }]);

    ctx.deliveries[0]!.status = DeliveryStatus.NO_RIDER_FOUND;
    const again = new Date(CLOSED.getTime() + 5_000);
    await restartV2Search(ctx.tx, ctx.deliveries[0]!, 'customer-1', again);
    await restartV2Search(ctx.tx, ctx.deliveries[0]!, 'customer-1', new Date(again.getTime() + 2_000));
    expect(ctx.notices.map((notice) => notice.dedupeKey)).toEqual([
      opportunityDedupe('express-1', START),
      opportunityDedupe('express-1', again),
    ]);
    expect(ctx.deliveries[0]?.searchStartedAt).toEqual(again);
  });

  it('expires the rider offer at the six-minute search deadline and leaves the delivery deadline alone', () => {
    const deliverBy = new Date('2026-10-29T08:00:00.000Z');
    const searchDeadline = v2SearchExpiresAt(START);
    expect(riderOpportunityExpiresAt(START)).toBe(searchDeadline.toISOString());
    expect(searchDeadline.getTime() - START.getTime()).toBe(360_000);
    expect(riderOpportunityExpiresAt(START)).not.toBe(deliverBy.toISOString());
    expect(riderOpportunityExpiresAt(null)).toBe('');
    expect(riderOpportunityExpiresAt(new Date(Number.NaN))).toBe('');
  });

  it('does not restart a passed delivery deadline or an assigned request', async () => {
    const passed = store(row('FLEXIBLE', new Date(START.getTime() - 1_000)));
    passed.deliveries[0]!.status = DeliveryStatus.NO_RIDER_FOUND;
    await expect(restartV2Search(passed.tx, passed.deliveries[0]!, 'customer-1', START)).rejects.toBeInstanceOf(ConflictException);
    expect(passed.deliveries[0]?.deliverBy).toEqual(new Date(START.getTime() - 1_000));
    expect(passed.deliveries[0]?.status).toBe(DeliveryStatus.NO_RIDER_FOUND);

    const future = new Date(START.getTime() + 3_600_000);
    const dated = store(row('EXPRESS', future));
    dated.deliveries[0]!.status = DeliveryStatus.NO_RIDER_FOUND;
    await restartV2Search(dated.tx, dated.deliveries[0]!, 'customer-1', START);
    expect(dated.deliveries[0]?.deliverBy).toEqual(future);

    const assigned = store(row('FLEXIBLE'));
    assigned.deliveries[0]!.status = DeliveryStatus.NO_RIDER_FOUND;
    assigned.assignments.push({ id: 'assignment-1', deliveryId: 'flexible-1', status: AssignmentStatus.ACCEPTED });
    await expect(restartV2Search(assigned.tx, assigned.deliveries[0]!, 'customer-1', START)).rejects.toBeInstanceOf(ConflictException);
  });

  it('leaves a cancelled request and a stored deadline for their existing closers', async () => {
    const cancelled = store(row('EXPRESS'));
    cancelled.deliveries[0]!.status = DeliveryStatus.CANCELLED;
    expect(await expireDueV2Searches(cancelled.tx, CLOSED)).toBe(0);
    expect(cancelled.deliveries[0]?.status).toBe(DeliveryStatus.CANCELLED);

    const dated = store(row('FLEXIBLE', new Date(START.getTime() - 1_000)));
    expect(await expireDueV2Searches(dated.tx, CLOSED)).toBe(0);
    expect(dated.deliveries[0]?.status).toBe(DeliveryStatus.CREATED);
    expect(v2SearchExpiryDecision({
      status: DeliveryStatus.CREATED,
      serviceClass: 'FLEXIBLE',
      searchGeneration: 0,
      searchStartedAt: START,
      claimedStartedAt: START,
      openBids: 0,
      acceptedAssignments: 1,
      deliverBy: null,
      now: CLOSED,
    })).toBe('keep');
  });
});

 describe('five-minute customer response window', () => {
  it('expires at exactly five minutes even before the search window ends', async () => {
    const ctx = store(row('EXPRESS'));
    const deadline = offerResponseDeadline(START);
    ctx.deliveries[0]!.offerResponseExpiresAt = deadline;
    ctx.bids.push({ id: 'one', deliveryId: 'express-1', status: BidStatus.OPEN });
    ctx.bids.push({ id: 'two', deliveryId: 'express-1', status: BidStatus.OPEN });
    expect(offerResponseElapsed(deadline, new Date(deadline.getTime() - 1))).toBe(false);
    expect(await expireDueV2Searches(ctx.tx, new Date(deadline.getTime() - 1))).toBe(0);
    expect(await expireDueV2Searches(ctx.tx, deadline)).toBe(1);
    expect(ctx.bids.every(bid => bid.status === BidStatus.EXPIRED)).toBe(true);
    expect(ctx.deliveries[0]!.status).toBe(DeliveryStatus.NO_RIDER_FOUND);
    expect(await expireDueV2Searches(ctx.tx, deadline)).toBe(0);
    // The response window has expired, but the same delivery can be searched again immediately.
    const first = await restartV2Search(ctx.tx, ctx.deliveries[0]!, 'customer', deadline);
    const second = await restartV2Search(ctx.tx, ctx.deliveries[0]!, 'customer', new Date(deadline.getTime() + 2_000));
    expect(first).toEqual({ deliveryId: 'express-1', status: DeliveryStatus.CREATED, searchGeneration: 0 });
    expect(second).toEqual(first);
    expect(ctx.deliveries[0]).toMatchObject({
      status: DeliveryStatus.CREATED,
      searchStartedAt: deadline,
      nextRetryAt: v2SearchExpiresAt(deadline),
      offerResponseExpiresAt: null,
    });
    expect(ctx.bids.every(bid => bid.status === BidStatus.EXPIRED)).toBe(true);
    expect(ctx.events).toEqual([
      { previousStatus: DeliveryStatus.CREATED, newStatus: DeliveryStatus.NO_RIDER_FOUND },
      { previousStatus: DeliveryStatus.NO_RIDER_FOUND, newStatus: DeliveryStatus.CREATED },
    ]);
  });
  it('retains the response window after the search window ends', async () => {
    const ctx = store(row('FLEXIBLE'));
    ctx.deliveries[0]!.offerResponseExpiresAt = offerResponseDeadline(new Date(CLOSED.getTime() - 1000));
    ctx.bids.push({ id: 'one', deliveryId: 'flexible-1', status: BidStatus.OPEN });
    expect(await expireDueV2Searches(ctx.tx, CLOSED)).toBe(0);
    expect(await expireDueV2Searches(ctx.tx, ctx.deliveries[0]!.offerResponseExpiresAt!)).toBe(1);
  });
});
