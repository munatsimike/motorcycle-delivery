import { BadRequestException, NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { BidStatus, Currency, ServiceClass } from '../generated/prisma/client.js';
import { BidService } from './bid.service.js';

const RIDER = '00000000-0000-7000-8000-0000000000a1';
const OTHER = '00000000-0000-7000-8000-0000000000b1';
const CONTEXT = { userId: 'user-1', riderProfileId: RIDER };
const OLDEST = '00000000-0000-7000-8000-000000000001';
const MIDDLE = '00000000-0000-7000-8000-000000000002';
const NEWEST = '00000000-0000-7000-8000-000000000003';
const FOREIGN = '00000000-0000-7000-8000-000000000004';

describe('signed-in rider bid read', () => {
  const previousFlag = process.env.V2_MARKETPLACE_ENABLED;
  afterEach(() => {
    if (previousFlag === undefined) {
      delete process.env.V2_MARKETPLACE_ENABLED;
    } else {
      process.env.V2_MARKETPLACE_ENABLED = previousFlag;
    }
  });

  it('returns only this rider, newest first, and keeps the next page stable', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const seen: unknown[] = [];
    const bids = new BidService(prisma(seen) as never);
    const first = await bids.listOwn(CONTEXT, { limit: '2' });
    expect(first.bids.map((bid) => bid.bidId)).toEqual([NEWEST, MIDDLE]);
    expect(first.nextCursor).toBeTruthy();
    expect(first.bids[0]).toMatchObject({
      deliveryId: deliveryId(NEWEST),
      amount: '10.00',
      currency: Currency.USD,
      status: BidStatus.OPEN,
      serviceClass: ServiceClass.FLEXIBLE,
      pickupAddress: 'Pickup',
      dropoffAddress: 'Dropoff',
    });
    expect(JSON.stringify(first)).not.toContain(OTHER);
    expect(JSON.stringify(first)).not.toContain('pickupContactPhone');
    expect(JSON.stringify(first)).not.toContain('idempotencyKey');
    const second = await bids.listOwn(CONTEXT, { limit: '2', cursor: first.nextCursor });
    expect(second.bids.map((bid) => bid.bidId)).toEqual([OLDEST]);
    expect(second.nextCursor).toBeNull();
    expect(seen).toHaveLength(2);
  });

  it('stays hidden while the marketplace flag is off', async () => {
    delete process.env.V2_MARKETPLACE_ENABLED;
    const seen: unknown[] = [];
    const bids = new BidService(prisma(seen) as never);
    await expect(bids.listOwn(CONTEXT, {})).rejects.toBeInstanceOf(NotFoundException);
    expect(seen).toHaveLength(0);
  });

  it('rejects a cursor that is not a page token', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const bids = new BidService(prisma([]) as never);
    await expect(bids.listOwn(CONTEXT, { cursor: 'not-a-cursor' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

function deliveryId(bidId: string): string {
  return `10000000-0000-7000-8000-${bidId.slice(-12)}`;
}

function stored(id: string, riderProfileId: string, createdAt: string) {
  const at = new Date(createdAt);
  return {
    id,
    deliveryId: deliveryId(id),
    riderProfileId,
    amount: '10.00',
    currency: Currency.USD,
    status: BidStatus.OPEN,
    createdAt: at,
    updatedAt: at,
    delivery: {
      serviceClass: ServiceClass.FLEXIBLE,
      pickupAddress: 'Pickup',
      dropoffAddress: 'Dropoff',
      deliverBy: new Date('2026-10-24T18:00:00.000Z'),
      pickupContactPhone: '+263770000099',
    },
  };
}

function prisma(seen: unknown[]) {
  const rows = [
    stored(MIDDLE, RIDER, '2026-10-24T08:00:00.000Z'),
    stored(OLDEST, RIDER, '2026-10-24T07:00:00.000Z'),
    stored(NEWEST, RIDER, '2026-10-24T09:00:00.000Z'),
    stored(FOREIGN, OTHER, '2026-10-24T10:00:00.000Z'),
  ];
  const tx = {
    delivery: {
      async findMany() {
        return [];
      },
    },
    bid: {
      async updateMany() {
        return { count: 0 };
      },
      async findMany(args: {
        where: {
          riderProfileId: string;
          OR?: [
            { createdAt: { lt: Date } },
            { AND: [{ createdAt: Date }, { id: { lt: string } }] },
          ];
        };
        take: number;
      }) {
        seen.push(args.where);
        const cursor = args.where.OR;
        const filtered = rows.filter((row) => {
          if (row.riderProfileId !== args.where.riderProfileId) {
            return false;
          }
          if (!cursor) {
            return true;
          }
          const createdAt = cursor[0].createdAt.lt;
          const id = cursor[1].AND[1].id.lt;
          return row.createdAt < createdAt || (row.createdAt.getTime() === createdAt.getTime() && row.id < id);
        });
        filtered.sort((left, right) => {
          const byTime = right.createdAt.getTime() - left.createdAt.getTime();
          if (byTime !== 0) {
            return byTime;
          }
          return right.id < left.id ? -1 : 1;
        });
        return filtered.slice(0, args.take);
      },
    },
  };
  return {
    async $transaction<T>(fn: (client: typeof tx) => Promise<T>): Promise<T> {
      return fn(tx);
    },
  };
}
