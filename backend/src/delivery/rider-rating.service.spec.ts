import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AssignmentStatus, DeliveryStatus, RiderClass } from '../generated/prisma/client.js';
import { RiderRatingService } from './rider-rating.service.js';

const CUSTOMER = { userId: 'user-1', role: 'CUSTOMER' as const, customerAccountId: 'account-1' };
const DELIVERY = '018f1a00-0000-7000-8000-000000000001';
const RIDER = '018f1a00-0000-7000-8000-000000000002';

describe('RiderRatingService', () => {
  it('rejects invalid stars and ineligible deliveries', async () => {
    const ratings = new RiderRatingService(store({ status: DeliveryStatus.COLLECTED }).prisma);
    await expect(ratings.rate(CUSTOMER, DELIVERY, { stars: 0 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(ratings.rate(CUSTOMER, DELIVERY, { stars: 6 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(ratings.rate(CUSTOMER, DELIVERY, { stars: 5 })).rejects.toBeInstanceOf(ConflictException);
    await expect(ratings.rate({ ...CUSTOMER, customerAccountId: 'other' }, DELIVERY, { stars: 5 }))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('stores one rating, updates class aggregates, and replays the same stars', async () => {
    const ctx = store({
      status: DeliveryStatus.DELIVERED,
      completedDeliveryCount: 80,
      ratingCount: 9,
      ratingSum: 41,
    });
    const ratings = new RiderRatingService(ctx.prisma);
    const first = await ratings.rate(CUSTOMER, DELIVERY, { stars: 4 });
    expect(first).toEqual({ deliveryId: DELIVERY, stars: 4, riderClass: RiderClass.GOLD });
    expect(ctx.profile.ratingCount).toBe(10);
    expect(ctx.profile.ratingSum).toBe(45);
    expect(ctx.profile.riderClass).toBe(RiderClass.GOLD);
    const replay = await ratings.rate(CUSTOMER, DELIVERY, { stars: 4 });
    expect(replay.stars).toBe(4);
    expect(ctx.ratings).toHaveLength(1);
    await expect(ratings.rate(CUSTOMER, DELIVERY, { stars: 5 })).rejects.toBeInstanceOf(ConflictException);
  });

  it('never fabricates an average before the first genuine rating', async () => {
    const ctx = store({ status: DeliveryStatus.DELIVERED });
    const ratings = new RiderRatingService(ctx.prisma);
    const state = await ratings.stateForDelivery(CUSTOMER, DELIVERY);
    expect(state).toEqual({ eligible: true, submitted: false, stars: null });
  });
});

function store(options?: {
  status?: DeliveryStatus;
  completedDeliveryCount?: number;
  ratingCount?: number;
  ratingSum?: number;
}) {
  const delivery = {
    id: DELIVERY,
    customerId: 'account-1',
    status: options?.status ?? DeliveryStatus.DELIVERED,
  };
  const profile = {
    id: RIDER,
    userId: 'user-rider',
    completedDeliveryCount: options?.completedDeliveryCount ?? 0,
    ratingCount: options?.ratingCount ?? 0,
    ratingSum: options?.ratingSum ?? 0,
    riderClass: RiderClass.SILVER,
  };
  const ratings: Array<{ deliveryId: string; riderProfileId: string; customerAccountId: string; stars: number }> = [];
  const db = {
    async $transaction<T>(fn: (tx: object) => Promise<T>): Promise<T> {
      return fn(db);
    },
    async $queryRaw() {
      return [];
    },
    delivery: {
      async findFirst({ where }: { where: { id: string; customerId: string } }) {
        return delivery.id === where.id && delivery.customerId === where.customerId ? delivery : null;
      },
    },
    deliveryAssignment: {
      async findFirst() {
        return delivery.status === DeliveryStatus.DELIVERED
          ? { id: 'assignment-1', riderProfileId: RIDER, status: AssignmentStatus.COMPLETED }
          : null;
      },
    },
    riderProfile: {
      async findUnique({ where }: { where: { id: string } }) {
        return where.id === profile.id ? profile : null;
      },
      async update({ data }: { data: Partial<typeof profile> }) {
        Object.assign(profile, data);
        return profile;
      },
    },
    riderRating: {
      async findUnique({ where }: { where: { deliveryId: string } }) {
        return ratings.find((row) => row.deliveryId === where.deliveryId) ?? null;
      },
      async create({ data }: { data: (typeof ratings)[number] }) {
        if (ratings.some((row) => row.deliveryId === data.deliveryId)) {
          const error = new Error('Unique constraint failed');
          (error as Error & { code: string }).code = 'P2002';
          throw error;
        }
        ratings.push(data);
        return data;
      },
    },
  };
  return {
    prisma: db as never,
    profile,
    ratings,
  };
}
