import { mockExactPage } from '../common/exact-page.test-support.js';
import { describe, expect, it } from 'vitest';
import { UserRole, DeliveryStatus, Currency } from '../generated/prisma/client.js';
import { encodeListCursor } from '../common/list-cursor.js';
import { DeliveryService } from './delivery.service.js';

const CUSTOMER = { userId: 'user-1', role: UserRole.CUSTOMER, customerAccountId: 'account-1' };
const TIED = new Date('2026-10-18T08:00:00.000Z');
const NEWER = '018f5b4a-7c3a-7c3a-8c3a-0000000000b2';
const SAME = '018f5b4a-7c3a-7c3a-8c3a-0000000000a1';
const OLDER = '018f5b4a-7c3a-7c3a-8c3a-000000000018';
const OTHER = '018f5b4a-7c3a-7c3a-8c3a-000000000099';

describe('customer delivery history cursor', () => {
  it('pages one account by creation time and continues after a deleted cursor', async () => {
    const rows = [
      delivery(NEWER, 'account-1', TIED),
      delivery(SAME, 'account-1', TIED),
      delivery(OLDER, 'account-1', new Date('2026-10-17T08:00:00.000Z')),
      delivery(OTHER, 'account-2', new Date('2026-10-21T08:00:00.000Z')),
    ];
    const service = new DeliveryService({
      async $queryRaw(query: { values: unknown[] }) { return mockExactPage(query, rows, row => row.customerId, row => row.createdAt); },
      delivery: {
        async count(args: { where: HistoryQuery }) {
          return rows.filter((row) => matches(row, args.where)).length;
        },
        async findMany(args: { where: HistoryQuery; take?: number; skip?: number }) {
          const matched = rows.filter((row) => matches(row, args.where))
            .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || (left.id < right.id ? 1 : -1));
          const start = args.skip ?? 0;
          return matched.slice(start, args.take == null ? undefined : start + args.take);
        },
      },
      $transaction(work: Array<Promise<unknown>>) {
        return Promise.all(work);
      },
    } as never);

    const first = await service.list(CUSTOMER, { pagination: 'cursor', limit: '1' });
    expect(first.data.map((row) => row.id)).toEqual([NEWER]);
    expect(first.pagination).toEqual({ limit: 1, nextCursor: encodeListCursor(TIED, NEWER) });
    const second = await service.list(CUSTOMER, { pagination: 'cursor', limit: '1', cursor: first.pagination.nextCursor });
    expect(second.data.map((row) => row.id)).toEqual([SAME]);
    const afterDeleted = await service.list(CUSTOMER, {
      pagination: 'cursor',
      limit: '20',
      cursor: encodeListCursor(TIED, '018f5b4a-7c3a-7c3a-8c3a-000000000098'),
    });
    expect(afterDeleted.data.map((row) => row.id)).toEqual([OLDER]);
    expect(afterDeleted.pagination).toEqual({ limit: 20, nextCursor: null });
    const offset = await service.list(CUSTOMER, { page: '1', limit: '2' });
    expect(offset.data.map((row) => row.id)).toEqual([NEWER, SAME]);
    expect(offset.pagination).toMatchObject({ page: 1, limit: 2, total: 3 });
    await expect(service.list(CUSTOMER, { pagination: 'cursor', cursor: NEWER })).rejects.toThrow('Invalid cursor');
  });
});

type HistoryQuery = {
  customerId?: string;
  id?: { in: string[] };
  AND?: Array<{ OR?: Array<{ createdAt?: Date | { lt?: Date }; id?: { lt?: string } }> }>;
};

function matches(row: ReturnType<typeof delivery>, where: HistoryQuery) {
  if (where.id && !where.id.in.includes(row.id)) return false;
  if (where.customerId && row.customerId !== where.customerId) return false;
  return where.AND?.every((clause) => !clause.OR || clause.OR.some((branch) => {
    const timeOk = branch.createdAt instanceof Date
      ? row.createdAt.getTime() === branch.createdAt.getTime()
      : branch.createdAt?.lt !== undefined && row.createdAt.getTime() < branch.createdAt.lt.getTime();
    const idOk = branch.id?.lt === undefined || row.id < branch.id.lt;
    return timeOk && idOk;
  })) ?? true;
}

function delivery(id: string, customerId: string, createdAt: Date) {
  return {
    id,
    customerId,
    status: DeliveryStatus.DELIVERED,
    createdAt,
    pickupAddress: 'Pickup',
    dropoffAddress: 'Dropoff',
    serviceClass: null,
    deliverBy: null,
    offerResponseExpiresAt: null,
    currency: Currency.USD,
    suggestedPrice: '1.00',
    price: '1.00',
    distanceMeters: 100,
    dropoffLatitude: null,
    dropoffLongitude: null,
  };
}
