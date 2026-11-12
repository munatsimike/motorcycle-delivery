import { ConflictException } from '@nestjs/common';
import { AssignmentStatus, BidStatus, DeliveryStatus, Prisma } from '../generated/prisma/client.js';
import { describe, expect, it } from 'vitest';
import {
  V2_SEARCH_WINDOW_MS,
  expireDueV2Searches,
  expireLockedV2Search,
  restartV2Search,
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
  const events: Array<{ previousStatus: DeliveryStatus | null; newStatus: DeliveryStatus }> = [];
  let onLock: (() => void) | null = null;
  const db = {
    async $queryRaw() {
      onLock?.();
      return [];
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
      async findMany({ where }: { where: { deliveryId: string; status: BidStatus } }) {
        return bids.filter((bid) => bid.deliveryId === where.deliveryId && bid.status === where.status);
      },
    },
    deliveryAssignment: {
      async findMany({ where }: { where: { deliveryId: string; status: AssignmentStatus } }) {
        return assignments.filter((assignment) => assignment.deliveryId === where.deliveryId && assignment.status === where.status);
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
    events,
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
    expect(ctx.assignments).toEqual([]);
    expect(ctx.events).toEqual([{ previousStatus: DeliveryStatus.NO_RIDER_FOUND, newStatus: DeliveryStatus.CREATED }]);
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
