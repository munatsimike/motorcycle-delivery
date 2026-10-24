import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AccountStatus,
  BidStatus,
  Currency,
  DeliveryStatus,
  MotorcycleVerificationStatus,
  RiderApprovalStatus,
  RiderVerificationStatus,
  ServiceClass,
} from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { BidService } from './bid.service.js';

const NOW = new Date('2026-10-24T08:00:00.000Z');
const DEADLINE = new Date('2026-10-24T18:00:00.000Z');
const DELIVERY = '00000000-0000-7000-8000-0000000000d1';
const RIDER = '00000000-0000-7000-8000-0000000000r1';
const OTHER_RIDER = '00000000-0000-7000-8000-0000000000r2';
const CUSTOMER = { userId: 'user-customer', role: 'CUSTOMER' as const, customerAccountId: 'account-1' };
const RIDER_CONTEXT = { userId: 'user-rider', riderProfileId: RIDER };

describe('V2 bid lifecycle', () => {
  const previousFlag = process.env.V2_MARKETPLACE_ENABLED;
  afterEach(() => {
    if (previousFlag === undefined) {
      delete process.env.V2_MARKETPLACE_ENABLED;
    } else {
      process.env.V2_MARKETPLACE_ENABLED = previousFlag;
    }
  });

  it('rejects bidding while the marketplace flag is off and writes nothing', async () => {
    delete process.env.V2_MARKETPLACE_ENABLED;
    const ctx = store();
    const bids = new BidService(ctx.prisma);
    await expect(bids.submit(RIDER_CONTEXT, bidBody(), 'key-1', NOW)).rejects.toBeInstanceOf(NotFoundException);
    expect(ctx.bids).toHaveLength(0);
    expect(ctx.reservationWrites).toBe(0);
    expect(ctx.ledgerWrites).toBe(0);
    expect(ctx.assignmentWrites).toBe(0);
  });

  it('stores one open bid, replays the same key, and rejects a second open bid', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    const bids = new BidService(ctx.prisma);
    const first = await bids.submit(RIDER_CONTEXT, bidBody(1_000), 'key-1', NOW);
    const replay = await bids.submit(RIDER_CONTEXT, bidBody(1_000), 'key-1', NOW);
    expect(replay).toEqual(first);
    expect(ctx.bids).toHaveLength(1);
    expect(first).toMatchObject({ amount: '10.00', amountCents: 1_000, currency: 'USD', status: 'OPEN', rider: { id: RIDER, name: 'Tendai Moyo' } });
    expect(first).not.toHaveProperty('phone');
    await expect(bids.submit(RIDER_CONTEXT, bidBody(1_200), 'key-2', NOW)).rejects.toThrow('This rider already has an open bid');
    await expect(bids.submit(RIDER_CONTEXT, bidBody(900), 'key-1', NOW)).rejects.toThrow('This idempotency key was already used');
    expect(ctx.bids).toHaveLength(1);
    expect(ctx.reservationWrites).toBe(0);
    expect(ctx.ledgerWrites).toBe(0);
    expect(ctx.assignmentWrites).toBe(0);
  });

  it('lets a second eligible rider bid on the same delivery', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    const bids = new BidService(ctx.prisma);
    await bids.submit(RIDER_CONTEXT, bidBody(1_000), 'key-1', NOW);
    const other = await bids.submit({ userId: 'user-rider-2', riderProfileId: OTHER_RIDER }, bidBody(800), 'key-2', NOW);
    expect(other.rider.id).toBe(OTHER_RIDER);
    expect(ctx.bids).toHaveLength(2);
  });

  it('serializes two submissions from the same rider so one open bid remains', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    const bids = new BidService(ctx.prisma);
    const results = await Promise.allSettled([
      bids.submit(RIDER_CONTEXT, bidBody(1_000), 'race-a', NOW),
      bids.submit(RIDER_CONTEXT, bidBody(1_100), 'race-b', NOW),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(ctx.bids.filter((bid) => bid.status === BidStatus.OPEN)).toHaveLength(1);
  });

  it('accepts a bid when wallet capacity is short and still requires a published rate', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const short = store({ basisPoints: 10_000, borrowingLimit: '0.00' });
    short.wallets.splice(0, short.wallets.length);
    const submitted = await new BidService(short.prisma).submit(RIDER_CONTEXT, bidBody(5_000), 'short', NOW);
    expect(submitted).toMatchObject({ amountCents: 5_000, status: 'OPEN' });
    expect(short.bids).toHaveLength(1);
    expect(short.reservationWrites).toBe(0);
    expect(short.ledgerWrites).toBe(0);
    expect(short.assignmentWrites).toBe(0);

    const missing = store({ rate: false });
    await expect(new BidService(missing.prisma).submit(RIDER_CONTEXT, bidBody(100), 'missing', NOW)).rejects.toThrow('A commission percentage has not been published');
    expect(missing.bids).toHaveLength(0);
  });

  it('rejects an ineligible rider, a bad amount, and another currency', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    ctx.profiles[0]!.approvalStatus = RiderApprovalStatus.PENDING;
    const bids = new BidService(ctx.prisma);
    await expect(bids.submit(RIDER_CONTEXT, bidBody(), 'pending', NOW)).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.bids).toHaveLength(0);
    await expect(bids.submit(RIDER_CONTEXT, { ...bidBody(), amountCents: 1.5 }, 'cents', NOW)).rejects.toBeInstanceOf(BadRequestException);
    await expect(bids.submit(RIDER_CONTEXT, { ...bidBody(), currency: 'ZWL' }, 'currency', NOW)).rejects.toThrow('USD is the only supported currency');
  });

  it('expires an open bid when the deadline passes and keeps the row', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    const bids = new BidService(ctx.prisma);
    const open = await bids.submit(RIDER_CONTEXT, bidBody(), 'key-1', NOW);
    const later = new Date(DEADLINE.getTime() + 1_000);
    await expect(bids.submit(RIDER_CONTEXT, bidBody(2_000), 'key-2', later)).rejects.toThrow('The bidding window has closed');
    expect(ctx.bids).toHaveLength(1);
    expect(ctx.bids[0]).toMatchObject({ id: open.id, status: BidStatus.EXPIRED });
    const listed = await bids.listForCustomer(CUSTOMER, DELIVERY, later);
    expect(listed).toEqual([]);
  });

  it('withdraws only the rider open bid and then allows a new one', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    const bids = new BidService(ctx.prisma);
    const open = await bids.submit(RIDER_CONTEXT, bidBody(), 'key-1', NOW);
    await expect(bids.withdraw({ userId: 'user-rider-2', riderProfileId: OTHER_RIDER }, open.id, NOW)).rejects.toBeInstanceOf(NotFoundException);
    expect(ctx.bids[0]?.status).toBe(BidStatus.OPEN);
    const withdrawn = await bids.withdraw(RIDER_CONTEXT, open.id, NOW);
    expect(withdrawn.status).toBe(BidStatus.WITHDRAWN);
    expect(ctx.bids).toHaveLength(1);
    const again = await bids.withdraw(RIDER_CONTEXT, open.id, NOW);
    expect(again.status).toBe(BidStatus.WITHDRAWN);
    const next = await bids.submit(RIDER_CONTEXT, bidBody(700), 'key-2', NOW);
    expect(next.status).toBe(BidStatus.OPEN);
    expect(ctx.bids).toHaveLength(2);
  });

  it('lists open bids only for the owning customer', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    const bids = new BidService(ctx.prisma);
    await bids.submit(RIDER_CONTEXT, bidBody(1_500), 'key-1', NOW);
    const page = await bids.listForCustomer(CUSTOMER, DELIVERY, NOW);
    expect(page).toHaveLength(1);
    expect(page[0]).toMatchObject({ amountCents: 1_500, rider: { name: 'Tendai Moyo' } });
    expect(JSON.stringify(page)).not.toContain('+263');
    expect(JSON.stringify(page)).not.toContain('licence');
    await expect(bids.listForCustomer({ ...CUSTOMER, customerAccountId: 'other' }, DELIVERY, NOW)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps an open bid hidden and rejects a new bid while Express is live', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    const bids = new BidService(ctx.prisma);
    const open = await bids.submit(RIDER_CONTEXT, bidBody(1_500), 'key-1', NOW);
    ctx.expressRiders.add(RIDER);
    await expect(bids.listForCustomer(CUSTOMER, DELIVERY, NOW)).resolves.toEqual([]);
    expect(ctx.bids.find((bid) => bid.id === open.id)?.status).toBe(BidStatus.OPEN);
    const other = '00000000-0000-7000-8000-0000000000d9';
    ctx.deliveries.push({ ...ctx.deliveries[0]!, id: other });
    await expect(bids.submit(RIDER_CONTEXT, { ...bidBody(900), deliveryId: other }, 'key-2', NOW)).rejects.toThrow(
      'You cannot submit a bid while an Express delivery is active',
    );
    expect(ctx.bids.filter((bid) => bid.deliveryId === other)).toHaveLength(0);
  });

  it('lists an open request without contact phones and hides it after the deadline', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    const bids = new BidService(ctx.prisma);
    const open = await bids.listOpenRequests(NOW);
    expect(open).toEqual([expect.objectContaining({
      id: DELIVERY,
      serviceClass: 'EXPRESS',
      suggestedPrice: '9.00',
      pickupAddress: '12 Samora Machel Avenue',
    })]);
    expect(JSON.stringify(open)).not.toContain('+263');
    ctx.deliveries[0]!.deliverBy = new Date(NOW.getTime() - 1_000);
    await expect(bids.listOpenRequests(NOW)).resolves.toEqual([]);
  });
});

function bidBody(amountCents = 1_000) {
  return { deliveryId: DELIVERY, amountCents, currency: 'USD' };
}

type BidRow = {
  id: string;
  deliveryId: string;
  riderProfileId: string;
  amount: string;
  currency: Currency;
  status: BidStatus;
  idempotencyKey: string;
  payloadHash: string;
  createdAt: Date;
};

type Profile = {
  id: string;
  userId: string;
  approvalStatus: RiderApprovalStatus;
  verificationStatus: RiderVerificationStatus;
};

function store(options?: { basisPoints?: number; borrowingLimit?: string; rate?: boolean }) {
  const bids: BidRow[] = [];
  const deliveries = [{
    id: DELIVERY,
    customerId: 'account-1',
    status: DeliveryStatus.CREATED,
    serviceClass: ServiceClass.EXPRESS,
    deliverBy: DEADLINE,
    searchGeneration: 0,
    currency: Currency.USD,
    suggestedPrice: '9.00',
    distanceMeters: 1_200,
    pickupAddress: '12 Samora Machel Avenue',
    dropoffAddress: '4 Jason Moyo Avenue',
    parcelDescription: 'Documents',
    parcelSize: 'SMALL',
    pickupContactPhone: '+263771234567',
  }];
  const profiles: Profile[] = [
    { id: RIDER, userId: 'user-rider', approvalStatus: RiderApprovalStatus.APPROVED, verificationStatus: RiderVerificationStatus.VERIFIED },
    { id: OTHER_RIDER, userId: 'user-rider-2', approvalStatus: RiderApprovalStatus.APPROVED, verificationStatus: RiderVerificationStatus.VERIFIED },
  ];
  const users = [
    { id: 'user-rider', accountStatus: AccountStatus.ACTIVE, phoneVerifiedAt: NOW, fullName: 'Tendai Moyo', phone: '+263771234567' },
    { id: 'user-rider-2', accountStatus: AccountStatus.ACTIVE, phoneVerifiedAt: NOW, fullName: 'Rudo Ncube', phone: '+263777654321' },
  ];
  const motorcycles = [
    { id: 'bike-1', riderProfileId: RIDER, verificationStatus: MotorcycleVerificationStatus.VERIFIED, isActive: true },
    { id: 'bike-2', riderProfileId: OTHER_RIDER, verificationStatus: MotorcycleVerificationStatus.VERIFIED, isActive: true },
  ];
  const wallets = [
    { id: 'wallet-1', riderProfileId: RIDER, balance: '0.00', borrowingLimitOverride: null },
    { id: 'wallet-2', riderProfileId: OTHER_RIDER, balance: '0.00', borrowingLimitOverride: null },
  ];
  const expressRiders = new Set<string>();
  const rates = options?.rate === false ? [] : [{ isActive: true, basisPoints: options?.basisPoints ?? 1_000, rateVersion: 1 }];
  const config = { isActive: true, defaultBorrowingLimit: options?.borrowingLimit ?? '50.00' };
  let reservationWrites = 0;
  let ledgerWrites = 0;
  let assignmentWrites = 0;
  let nextBid = 1;
  let queue = Promise.resolve();
  const db = {
    async $transaction<T>(fn: (tx: typeof db) => Promise<T>): Promise<T> {
      const previous = queue;
      let release = () => {};
      queue = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      const backup = bids.map((bid) => ({ ...bid }));
      try {
        return await fn(db);
      } catch (error) {
        bids.splice(0, bids.length, ...backup);
        throw error;
      } finally {
        release();
      }
    },
    async $queryRaw() {
      return [];
    },
    delivery: {
      async findUnique({ where }: { where: { id: string } }) {
        return deliveries.find((delivery) => delivery.id === where.id) ?? null;
      },
      async update({ where, data }: { where: { id: string }; data: { status?: DeliveryStatus } }) {
        const row = deliveries.find((delivery) => delivery.id === where.id);
        if (!row) throw new Error('missing delivery');
        Object.assign(row, data);
        return row;
      },
      async findFirst({ where }: { where: { id: string; customerId: string } }) {
        return deliveries.find((delivery) => delivery.id === where.id && delivery.customerId === where.customerId) ?? null;
      },
      async findMany({ where }: { where: { status: DeliveryStatus; deliverBy: { gt?: Date; lte?: Date }; searchGeneration: number } }) {
        return deliveries.filter((delivery) => (
          delivery.status === where.status
          && delivery.serviceClass != null
          && delivery.searchGeneration === where.searchGeneration
          && (where.deliverBy.gt ? delivery.deliverBy > where.deliverBy.gt : true)
          && (where.deliverBy.lte ? delivery.deliverBy.getTime() <= where.deliverBy.lte.getTime() : true)
        ));
      },
    },
    deliveryStatusEvent: {
      async create() {
        return {};
      },
    },
    bid: {
      async findUnique({ where }: { where: { id?: string; idempotencyKey?: string } }) {
        const row = bids.find((bid) => (where.id ? bid.id === where.id : bid.idempotencyKey === where.idempotencyKey));
        return row ? withRider(row) : null;
      },
      async findFirst({ where }: { where: { deliveryId: string; riderProfileId: string; status: BidStatus } }) {
        return bids.find((bid) => bid.deliveryId === where.deliveryId && bid.riderProfileId === where.riderProfileId && bid.status === where.status) ?? null;
      },
      async findMany({ where }: { where: { deliveryId: string; status: BidStatus } }) {
        return bids
          .filter((bid) => bid.deliveryId === where.deliveryId && bid.status === where.status)
          .map((bid) => withRider(bid));
      },
      async updateMany({ where, data }: { where: { status: BidStatus; deliveryId?: string; delivery?: { deliverBy: { lte: Date } } }; data: { status: BidStatus } }) {
        for (const bid of bids) {
          const delivery = deliveries.find((item) => item.id === bid.deliveryId);
          const due = !where.delivery || (delivery != null && delivery.deliverBy.getTime() <= where.delivery.deliverBy.lte.getTime());
          if (
            bid.status === where.status
            && (!where.deliveryId || bid.deliveryId === where.deliveryId)
            && due
          ) {
            bid.status = data.status;
          }
        }
        return { count: 0 };
      },
      async create({ data }: { data: Omit<BidRow, 'id'> }) {
        if (bids.some((bid) => bid.idempotencyKey === data.idempotencyKey)) {
          throw uniqueViolation();
        }
        if (data.status === BidStatus.OPEN && bids.some((bid) => bid.status === BidStatus.OPEN && bid.deliveryId === data.deliveryId && bid.riderProfileId === data.riderProfileId)) {
          throw uniqueViolation();
        }
        const row = { id: `00000000-0000-7000-8000-${String(nextBid).padStart(12, '0')}`, ...data };
        nextBid += 1;
        bids.push(row);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: { status: BidStatus } }) {
        const row = bids.find((bid) => bid.id === where.id);
        if (!row) {
          throw new Error('missing bid');
        }
        Object.assign(row, data);
        return row;
      },
    },
    riderProfile: {
      async findUnique({ where }: { where: { id: string } }) {
        const profile = profiles.find((item) => item.id === where.id);
        if (!profile) {
          return null;
        }
        const user = users.find((item) => item.id === profile.userId);
        return { ...profile, user: { fullName: user?.fullName ?? '' } };
      },
    },
    user: {
      async findUnique({ where }: { where: { id: string } }) {
        return users.find((user) => user.id === where.id) ?? null;
      },
    },
    motorcycle: {
      async findMany({ where }: { where: { riderProfileId: string } }) {
        return motorcycles.filter((motorcycle) => motorcycle.riderProfileId === where.riderProfileId);
      },
    },
    v2CommissionRate: {
      async findFirst({ where }: { where: { isActive: boolean } }) {
        return rates.find((rate) => rate.isActive === where.isActive) ?? null;
      },
    },
    riderWallet: {
      async findUnique({ where }: { where: { riderProfileId: string } }) {
        return wallets.find((wallet) => wallet.riderProfileId === where.riderProfileId) ?? null;
      },
    },
    riderWalletEntry: {
      async aggregate() {
        return { _sum: { amount: '0.00' } };
      },
      async create() {
        ledgerWrites += 1;
        throw new Error('ledger written');
      },
    },
    walletConfig: {
      async findFirst() {
        return config;
      },
    },
    walletFeeReservation: {
      async findMany() {
        return [];
      },
      async create() {
        reservationWrites += 1;
        throw new Error('reservation written');
      },
    },
    deliveryAssignment: {
      async findFirst({ where }: { where?: { riderProfileId?: string; serviceClass?: ServiceClass } }) {
        if (where?.riderProfileId && where.serviceClass === ServiceClass.EXPRESS && expressRiders.has(where.riderProfileId)) {
          return { id: 'live-express', riderProfileId: where.riderProfileId };
        }
        return null;
      },
      async findMany({ where }: { where?: { riderProfileId?: { in?: string[] }; serviceClass?: ServiceClass } }) {
        const ids = where?.riderProfileId?.in ?? [];
        if (where?.serviceClass !== ServiceClass.EXPRESS) return [];
        return ids.filter((id) => expressRiders.has(id)).map((riderProfileId) => ({ riderProfileId }));
      },
      async create() {
        assignmentWrites += 1;
        throw new Error('assignment written');
      },
    },
  };
  return {
    prisma: db as unknown as PrismaService,
    bids,
    deliveries,
    profiles,
    wallets,
    get reservationWrites() {
      return reservationWrites;
    },
    get ledgerWrites() {
      return ledgerWrites;
    },
    get assignmentWrites() {
      return assignmentWrites;
    },
    expressRiders,
  };

  function withRider(bid: BidRow) {
    const profile = profiles.find((item) => item.id === bid.riderProfileId);
    const user = users.find((item) => item.id === profile?.userId);
    return { ...bid, riderProfile: { user: { fullName: user?.fullName ?? '' } } };
  }
}

function uniqueViolation(): Error {
  const error = new Error('Unique constraint failed');
  (error as Error & { code: string }).code = 'P2002';
  return error;
}
