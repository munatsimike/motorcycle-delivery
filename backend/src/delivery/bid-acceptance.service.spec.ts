import { ConflictException, NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AccountStatus,
  AssignmentStatus,
  BidStatus,
  Currency,
  DeliveryStatus,
  MotorcycleVerificationStatus,
  RiderApprovalStatus,
  RiderAvailability,
  RiderVerificationStatus,
  ServiceClass,
} from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { BidAcceptanceService } from './bid-acceptance.service.js';

const NOW = new Date('2026-10-24T08:00:00.000Z');
const DEADLINE = new Date('2026-10-24T18:00:00.000Z');
const DELIVERY = '00000000-0000-7000-8000-0000000000d1';
const DELIVERY_2 = '00000000-0000-7000-8000-0000000000d2';
const BID = '00000000-0000-7000-8000-0000000000c1';
const BID_2 = '00000000-0000-7000-8000-0000000000c2';
const BID_3 = '00000000-0000-7000-8000-0000000000c3';
const RIDER = '00000000-0000-7000-8000-0000000000r1';
const RIDER_2 = '00000000-0000-7000-8000-0000000000r2';
const CUSTOMER = { userId: 'user-customer', role: 'CUSTOMER' as const, customerAccountId: 'account-1' };

describe('customer bid acceptance', () => {
  const previousFlag = process.env.V2_MARKETPLACE_ENABLED;
  afterEach(() => {
    if (previousFlag === undefined) delete process.env.V2_MARKETPLACE_ENABLED;
    else process.env.V2_MARKETPLACE_ENABLED = previousFlag;
  });

  it('accepts one bid, snapshots the published rate, and reserves the commission once', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    const service = new BidAcceptanceService(ctx.prisma);
    const accepted = await service.accept(CUSTOMER, DELIVERY, BID, 'accept-1', NOW);
    const replay = await service.accept(CUSTOMER, DELIVERY, BID, 'accept-1', NOW);
    expect(accepted).toMatchObject({
      deliveryId: DELIVERY,
      bidId: BID,
      status: 'RIDER_ASSIGNED',
      availability: 'AVAILABLE',
      acceptedBidAmount: '10.00',
      commissionAmount: '1.00',
      basisPoints: 1_000,
      rateVersion: 3,
      reserved: true,
      replayed: false,
    });
    expect(replay).toMatchObject({ assignmentId: accepted.assignmentId, replayed: true, reserved: true });
    await expect(service.accept(CUSTOMER, DELIVERY, BID_2, 'accept-1', NOW)).rejects.toThrow('This idempotency key was already used');
    expect(ctx.assignments).toHaveLength(1);
    expect(ctx.assignments[0]).toMatchObject({
      acceptedPlatformFee: null,
      acceptedFeeConfigVersion: null,
      serviceClass: 'EXPRESS',
      acceptedCommissionBasisPoints: 1_000,
      acceptedCommissionAmount: '1.00',
    });
    expect(ctx.reservations).toEqual([expect.objectContaining({ amount: '1.00', status: 'OPEN', configVersion: 3 })]);
    expect(ctx.ledgerWrites).toBe(0);
    expect(ctx.bids.find((bid) => bid.id === BID)?.status).toBe(BidStatus.ACCEPTED);
    expect(ctx.bids.find((bid) => bid.id === BID_2)?.status).toBe(BidStatus.SUPERSEDED);
    expect(ctx.deliveries[0]).toMatchObject({ status: DeliveryStatus.RIDER_ASSIGNED, price: '10.00', suggestedPrice: '9.00' });
    expect(ctx.profiles[0]?.availability).toBe(RiderAvailability.AVAILABLE);
    expect(ctx.profiles[0]?.receivingRequests).toBe(true);
    ctx.rates[0]!.basisPoints = 2_500;
    expect(ctx.assignments[0]?.acceptedCommissionBasisPoints).toBe(1_000);
    expect(ctx.assignments[0]?.acceptedCommissionAmount).toBe('1.00');
  });

  it('accepts a deadline-free request and still closes a request whose deadline has passed', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const open = store();
    open.deliveries[0]!.deliverBy = null;
    const accepted = await new BidAcceptanceService(open.prisma).accept(CUSTOMER, DELIVERY, BID, 'open-ended', NOW);
    expect(accepted.deliveryId).toBe(DELIVERY);
    expect(open.assignments[0]?.offerExpiresAt ?? null).toBeNull();
    expect(open.reservations).toHaveLength(1);
    expect(open.deliveries[0]?.status).toBe(DeliveryStatus.RIDER_ASSIGNED);
    expect(open.deliveries[0]?.deliverBy ?? null).toBeNull();

    const closed = store();
    closed.deliveries[0]!.deliverBy = new Date(NOW.getTime() - 1_000);
    await expect(new BidAcceptanceService(closed.prisma).accept(CUSTOMER, DELIVERY, BID, 'closed', NOW)).rejects.toThrow('The bidding window has closed');
    expect(closed.assignments).toHaveLength(0);
    expect(closed.reservations).toHaveLength(0);
  });

  it('accepts a published 0% rate with no reservation and no ledger entry', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store({ basisPoints: 0, borrowingLimit: '0.00' });
    const accepted = await new BidAcceptanceService(ctx.prisma).accept(CUSTOMER, DELIVERY, BID, 'zero', NOW);
    expect(accepted).toMatchObject({ commissionAmount: '0.00', basisPoints: 0, reserved: false });
    expect(ctx.reservations).toHaveLength(0);
    expect(ctx.ledgerWrites).toBe(0);
    expect(ctx.assignments).toHaveLength(1);
  });

  it('rejects a missing rate, a short wallet, a withdrawn bid, and a closed window without writing', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const missing = store({ rate: false });
    await expect(new BidAcceptanceService(missing.prisma).accept(CUSTOMER, DELIVERY, BID, 'missing', NOW)).rejects.toThrow('A commission percentage has not been published');
    expect(missing.assignments).toHaveLength(0);
    expect(missing.bids.find((bid) => bid.id === BID)?.status).toBe(BidStatus.OPEN);

    const short = store({ borrowingLimit: '0.00' });
    short.reservations.push({
      id: 'open-fee',
      riderWalletId: 'wallet-1',
      deliveryId: '00000000-0000-7000-8000-000000000099',
      assignmentId: '00000000-0000-7000-8000-000000000098',
      amount: '0.00',
      status: 'OPEN',
      configVersion: 1,
    });
    short.reservations[0]!.amount = '0.00';
    short.wallets[0]!.borrowingLimitOverride = null;
    await expect(new BidAcceptanceService(short.prisma).accept(CUSTOMER, DELIVERY, BID, 'short', NOW)).rejects.toThrow('Wallet capacity is not enough for this bid');
    expect(short.assignments).toHaveLength(0);
    expect(short.bids.find((bid) => bid.id === BID)?.status).toBe(BidStatus.OPEN);
    expect(short.deliveries[0]?.status).toBe(DeliveryStatus.CREATED);

    const held = store({ borrowingLimit: '1.00' });
    held.reservations.push({
      id: 'held',
      riderWalletId: 'wallet-1',
      deliveryId: '00000000-0000-7000-8000-000000000099',
      assignmentId: '00000000-0000-7000-8000-000000000098',
      amount: '1.00',
      status: 'OPEN',
      configVersion: 1,
    });
    await expect(new BidAcceptanceService(held.prisma).accept(CUSTOMER, DELIVERY, BID, 'held', NOW)).rejects.toThrow('Wallet capacity is not enough for this bid');
    expect(held.bids.find((bid) => bid.id === BID)?.status).toBe(BidStatus.OPEN);

    const withdrawn = store();
    withdrawn.bids[0]!.status = BidStatus.WITHDRAWN;
    await expect(new BidAcceptanceService(withdrawn.prisma).accept(CUSTOMER, DELIVERY, BID, 'withdrawn', NOW)).rejects.toThrow('This bid is not open');
    expect(withdrawn.bids[0]?.status).toBe(BidStatus.WITHDRAWN);
    expect(withdrawn.assignments).toHaveLength(0);

    const closed = store();
    closed.deliveries[0]!.deliverBy = new Date(NOW.getTime() - 1_000);
    await expect(new BidAcceptanceService(closed.prisma).accept(CUSTOMER, DELIVERY, BID, 'closed', NOW)).rejects.toThrow('The bidding window has closed');
    expect(closed.bids.find((bid) => bid.id === BID)?.status).toBe(BidStatus.EXPIRED);
    expect(closed.assignments).toHaveLength(0);
  });

  it('lets one of two competing accepts win and keeps the other bid superseded', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    const service = new BidAcceptanceService(ctx.prisma);
    const results = await Promise.allSettled([
      service.accept(CUSTOMER, DELIVERY, BID, 'race-a', NOW),
      service.accept(CUSTOMER, DELIVERY, BID_2, 'race-b', NOW),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(ctx.assignments).toHaveLength(1);
    expect(ctx.reservations).toHaveLength(1);
    expect(ctx.bids.filter((bid) => bid.status === BidStatus.ACCEPTED)).toHaveLength(1);
    expect(ctx.bids.filter((bid) => bid.status === BidStatus.SUPERSEDED)).toHaveLength(1);
  });

  it('accepts a second Express delivery for a rider who already has one', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    const service = new BidAcceptanceService(ctx.prisma);
    await service.accept(CUSTOMER, DELIVERY, BID, 'first', NOW);
    await service.accept(CUSTOMER, DELIVERY_2, BID_3, 'second', NOW);
    expect(ctx.assignments).toHaveLength(2);
    expect(ctx.assignments.every((row) => row.riderProfileId === RIDER && row.serviceClass === ServiceClass.EXPRESS)).toBe(true);
    expect(ctx.bids.find((bid) => bid.id === BID_3)?.status).toBe(BidStatus.ACCEPTED);
    expect(ctx.deliveries.find((delivery) => delivery.id === DELIVERY_2)?.status).toBe(DeliveryStatus.RIDER_ASSIGNED);
    expect(ctx.profiles[0]?.receivingRequests).toBe(true);
  });

  it('accepts another Flexible delivery and an Express delivery without changing receiving', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    ctx.deliveries[0]!.serviceClass = ServiceClass.FLEXIBLE;
    ctx.deliveries[1]!.serviceClass = ServiceClass.FLEXIBLE;
    const expressDelivery = '00000000-0000-7000-8000-0000000000d4';
    const expressBid = '00000000-0000-7000-8000-0000000000c5';
    const laterDelivery = '00000000-0000-7000-8000-0000000000d5';
    const laterBid = '00000000-0000-7000-8000-0000000000c6';
    ctx.deliveries.push({ ...delivery(expressDelivery), serviceClass: ServiceClass.EXPRESS });
    ctx.deliveries.push({ ...delivery(laterDelivery), serviceClass: ServiceClass.FLEXIBLE });
    ctx.bids.push({ id: expressBid, deliveryId: expressDelivery, riderProfileId: RIDER, amount: '15.00', status: BidStatus.OPEN });
    ctx.bids.push({ id: laterBid, deliveryId: laterDelivery, riderProfileId: RIDER, amount: '11.00', status: BidStatus.OPEN });
    const service = new BidAcceptanceService(ctx.prisma);
    await service.accept(CUSTOMER, DELIVERY, BID, 'flex-1', NOW);
    await service.accept(CUSTOMER, DELIVERY_2, BID_3, 'flex-2', NOW);
    ctx.profiles[0]!.receivingRequests = false;
    await expect(service.accept(CUSTOMER, expressDelivery, expressBid, 'paused', NOW)).rejects.toThrow('This rider is not receiving requests');
    ctx.profiles[0]!.receivingRequests = true;
    await service.accept(CUSTOMER, expressDelivery, expressBid, 'express', NOW);
    expect(ctx.assignments.map((row) => row.serviceClass)).toEqual([ServiceClass.FLEXIBLE, ServiceClass.FLEXIBLE, ServiceClass.EXPRESS]);
    expect(ctx.profiles[0]?.availability).toBe(RiderAvailability.AVAILABLE);
    expect(ctx.profiles[0]?.receivingRequests).toBe(true);
    expect(ctx.reservations).toHaveLength(3);
    await service.accept(CUSTOMER, laterDelivery, laterBid, 'after-express', NOW);
    expect(ctx.reservations).toHaveLength(4);
    expect(ctx.assignments.filter((row) => row.deliveryId === laterDelivery)).toHaveLength(1);
    expect(ctx.bids.find((bid) => bid.id === laterBid)?.status).toBe(BidStatus.ACCEPTED);
  });

  it('rolls back the assignment and bid changes when the reservation insert fails', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    ctx.failReservation = true;
    await expect(new BidAcceptanceService(ctx.prisma).accept(CUSTOMER, DELIVERY, BID, 'boom', NOW)).rejects.toThrow('reservation failed');
    expect(ctx.assignments).toHaveLength(0);
    expect(ctx.reservations).toHaveLength(0);
    expect(ctx.bids.find((bid) => bid.id === BID)?.status).toBe(BidStatus.OPEN);
    expect(ctx.bids.find((bid) => bid.id === BID_2)?.status).toBe(BidStatus.OPEN);
    expect(ctx.deliveries[0]?.status).toBe(DeliveryStatus.CREATED);
    expect(ctx.profiles[0]?.availability).toBe(RiderAvailability.AVAILABLE);
  });

  it('rejects a positive commission when the rider has no wallet', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    ctx.wallets.splice(0, ctx.wallets.length);
    await expect(new BidAcceptanceService(ctx.prisma).accept(CUSTOMER, DELIVERY, BID, 'no-wallet', NOW)).rejects.toThrow('Wallet capacity is not enough for this bid');
    expect(ctx.assignments).toHaveLength(0);
    expect(ctx.bids.find((bid) => bid.id === BID)?.status).toBe(BidStatus.OPEN);
  });

  it('reserves one commission for each rider when two deliveries are accepted together', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    const third = '00000000-0000-7000-8000-0000000000d3';
    const bid = '00000000-0000-7000-8000-0000000000c4';
    ctx.deliveries.push({ ...ctx.deliveries[0]!, id: third });
    ctx.bids.push({ id: bid, deliveryId: third, riderProfileId: RIDER_2, amount: '20.00', status: BidStatus.OPEN });
    const service = new BidAcceptanceService(ctx.prisma);
    const results = await Promise.all([
      service.accept(CUSTOMER, DELIVERY, BID, 'rider-a', NOW),
      service.accept(CUSTOMER, third, bid, 'rider-b', NOW),
    ]);
    expect(results.map((row) => row.commissionAmount).sort()).toEqual(['1.00', '2.00']);
    expect(ctx.reservations).toHaveLength(2);
    expect(ctx.ledgerWrites).toBe(0);
  });

  it('rejects a new commitment while paused or offline and still accepts one during a V1 assignment', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const paused = store();
    paused.profiles[0]!.receivingRequests = false;
    await expect(new BidAcceptanceService(paused.prisma).accept(CUSTOMER, DELIVERY, BID, 'paused', NOW)).rejects.toThrow('This rider is not receiving requests');
    expect(paused.assignments).toHaveLength(0);
    expect(paused.profiles[0]?.receivingRequests).toBe(false);

    const offline = store();
    offline.profiles[0]!.availability = RiderAvailability.OFFLINE;
    await expect(new BidAcceptanceService(offline.prisma).accept(CUSTOMER, DELIVERY, BID, 'offline', NOW)).rejects.toThrow('This rider is not available');
    expect(offline.assignments).toHaveLength(0);

    const busy = store();
    busy.profiles[0]!.availability = RiderAvailability.BUSY;
    await new BidAcceptanceService(busy.prisma).accept(CUSTOMER, DELIVERY, BID, 'busy', NOW);
    expect(busy.assignments).toHaveLength(1);
    expect(busy.profiles[0]?.receivingRequests).toBe(true);

    const legacy = store();
    legacy.assignments.push({
      id: '00000000-0000-7000-8000-000000000099',
      deliveryId: '00000000-0000-7000-8000-000000000098',
      riderProfileId: RIDER,
      status: AssignmentStatus.ACCEPTED,
      idempotencyKey: 'v1-offer',
      payloadHash: 'a'.repeat(64),
      acceptedPlatformFee: null,
      acceptedFeeConfigVersion: null,
      serviceClass: null,
      acceptedBidAmount: null,
      acceptedCommissionBasisPoints: 0,
      acceptedV2CommissionRateVersion: 0,
      acceptedCommissionAmount: '0.00',
    });
    await new BidAcceptanceService(legacy.prisma).accept(CUSTOMER, DELIVERY, BID, 'v1', NOW);
    expect(legacy.assignments).toHaveLength(2);
    expect(legacy.profiles[0]?.availability).toBe(RiderAvailability.AVAILABLE);
    expect(legacy.profiles[0]?.receivingRequests).toBe(true);
  });

  it('does not accept another customer delivery while the flag is off', async () => {
    delete process.env.V2_MARKETPLACE_ENABLED;
    const ctx = store();
    await expect(new BidAcceptanceService(ctx.prisma).accept(CUSTOMER, DELIVERY, BID, 'off', NOW)).rejects.toBeInstanceOf(NotFoundException);
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    await expect(new BidAcceptanceService(ctx.prisma).accept({ ...CUSTOMER, customerAccountId: 'other' }, DELIVERY, BID, 'other', NOW)).rejects.toBeInstanceOf(NotFoundException);
    expect(ctx.assignments).toHaveLength(0);
  });
});

type BidRow = {
  id: string;
  deliveryId: string;
  riderProfileId: string;
  amount: string;
  status: BidStatus;
};

type AssignmentRow = {
  id: string;
  deliveryId: string;
  riderProfileId: string;
  status: AssignmentStatus;
  idempotencyKey: string;
  payloadHash: string;
  acceptedPlatformFee: null;
  acceptedFeeConfigVersion: null;
  serviceClass: ServiceClass | null;
  acceptedBidAmount: string | null;
  acceptedCommissionBasisPoints: number;
  acceptedV2CommissionRateVersion: number;
  acceptedCommissionAmount: string;
  offerExpiresAt?: Date | null;
};

function store(options?: { basisPoints?: number; borrowingLimit?: string; rate?: boolean }) {
  const bids: BidRow[] = [
    { id: BID, deliveryId: DELIVERY, riderProfileId: RIDER, amount: '10.00', status: BidStatus.OPEN },
    { id: BID_2, deliveryId: DELIVERY, riderProfileId: RIDER_2, amount: '8.00', status: BidStatus.OPEN },
    { id: BID_3, deliveryId: DELIVERY_2, riderProfileId: RIDER, amount: '12.00', status: BidStatus.OPEN },
  ];
  const deliveries = [
    delivery(DELIVERY),
    delivery(DELIVERY_2),
  ];
  const profiles: Array<{
    id: string;
    userId: string;
    approvalStatus: RiderApprovalStatus;
    verificationStatus: RiderVerificationStatus;
    availability: RiderAvailability;
    receivingRequests: boolean | null;
  }> = [
    { id: RIDER, userId: 'user-rider', approvalStatus: RiderApprovalStatus.APPROVED, verificationStatus: RiderVerificationStatus.VERIFIED, availability: RiderAvailability.AVAILABLE, receivingRequests: true },
    { id: RIDER_2, userId: 'user-rider-2', approvalStatus: RiderApprovalStatus.APPROVED, verificationStatus: RiderVerificationStatus.VERIFIED, availability: RiderAvailability.AVAILABLE, receivingRequests: true as boolean | null },
  ];
  const users = [
    { id: 'user-rider', accountStatus: AccountStatus.ACTIVE, phoneVerifiedAt: NOW },
    { id: 'user-rider-2', accountStatus: AccountStatus.ACTIVE, phoneVerifiedAt: NOW },
  ];
  const motorcycles = [
    { id: '00000000-0000-7000-8000-0000000000b1', riderProfileId: RIDER, verificationStatus: MotorcycleVerificationStatus.VERIFIED, isActive: true },
    { id: '00000000-0000-7000-8000-0000000000b2', riderProfileId: RIDER_2, verificationStatus: MotorcycleVerificationStatus.VERIFIED, isActive: true },
  ];
  const wallets = [
    { id: 'wallet-1', riderProfileId: RIDER, balance: '0.00', borrowingLimitOverride: null as string | null },
    { id: 'wallet-2', riderProfileId: RIDER_2, balance: '0.00', borrowingLimitOverride: null as string | null },
  ];
  const rates = options?.rate === false ? [] : [{ isActive: true, basisPoints: options?.basisPoints ?? 1_000, rateVersion: 3 }];
  const config = { isActive: true, defaultBorrowingLimit: options?.borrowingLimit ?? '50.00' };
  const assignments: AssignmentRow[] = [];
  const reservations: Array<{ id: string; riderWalletId: string; deliveryId: string; assignmentId: string; amount: string; status: string; configVersion: number }> = [];
  let ledgerWrites = 0;
  let nextAssignment = 1;
  let queue = Promise.resolve();
  const state = {
    failReservation: false,
    get ledgerWrites() {
      return ledgerWrites;
    },
  };
  const db = {
    async $queryRaw(strings: TemplateStringsArray) {
      const text = strings.join(' ');
      if (text.includes('v2_commission_rates')) {
        return rates.filter((rate) => rate.isActive).map((rate) => ({
          rate_version: rate.rateVersion,
          basis_points: rate.basisPoints,
        }));
      }
      return [];
    },
    async $transaction<T>(fn: (tx: object) => Promise<T>): Promise<T> {
      const previous = queue;
      let release = () => {};
      queue = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      const backup = {
        bids: bids.map((bid) => ({ ...bid })),
        deliveries: deliveries.map((row) => ({ ...row })),
        profiles: profiles.map((row) => ({ ...row })),
        assignments: assignments.map((row) => ({ ...row })),
        reservations: reservations.map((row) => ({ ...row })),
      };
      try {
        return await fn(db);
      } catch (error) {
        bids.splice(0, bids.length, ...backup.bids);
        deliveries.splice(0, deliveries.length, ...backup.deliveries);
        profiles.splice(0, profiles.length, ...backup.profiles);
        assignments.splice(0, assignments.length, ...backup.assignments);
        reservations.splice(0, reservations.length, ...backup.reservations);
        throw error;
      } finally {
        release();
      }
    },
    delivery: {
      async findUnique({ where }: { where: { id: string } }) {
        return deliveries.find((row) => row.id === where.id) ?? null;
      },
      async findMany({ where }: { where: { status?: DeliveryStatus; deliverBy?: { lte?: Date }; searchGeneration?: number } }) {
        const deadline = where.deliverBy?.lte;
        if (!deadline) return [];
        return deliveries.filter((row) => (
          row.status === where.status
          && row.serviceClass != null
          && row.searchGeneration === where.searchGeneration
          && row.deliverBy != null
          && row.deliverBy.getTime() <= deadline.getTime()
        ));
      },
      async findFirst({ where }: { where: { id: string; customerId: string } }) {
        return deliveries.find((row) => row.id === where.id && row.customerId === where.customerId) ?? null;
      },
      async update({ where, data }: { where: { id: string }; data: { status: DeliveryStatus; price: string } }) {
        const row = deliveries.find((item) => item.id === where.id);
        if (!row) throw new Error('missing delivery');
        Object.assign(row, data);
        return row;
      },
    },
    bid: {
      async findUnique({ where }: { where: { id: string } }) {
        return bids.find((bid) => bid.id === where.id) ?? null;
      },
      async findFirst({ where }: { where: { deliveryId: string; riderProfileId: string; status: BidStatus } }) {
        return bids.find((bid) => bid.deliveryId === where.deliveryId && bid.riderProfileId === where.riderProfileId && bid.status === where.status) ?? null;
      },
      async updateMany({ where, data }: { where: { deliveryId?: string; status: BidStatus; id?: { not: string }; delivery?: { deliverBy: { lte: Date } } }; data: { status: BidStatus } }) {
        for (const bid of bids) {
          const delivery = deliveries.find((row) => row.id === bid.deliveryId);
          const due = where.delivery ? delivery?.deliverBy != null && delivery.deliverBy.getTime() <= where.delivery.deliverBy.lte.getTime() : true;
          if (bid.status === where.status && (!where.deliveryId || bid.deliveryId === where.deliveryId) && (!where.id || bid.id !== where.id.not) && due) {
            bid.status = data.status;
          }
        }
        return { count: 0 };
      },
      async update({ where, data }: { where: { id: string }; data: { status: BidStatus } }) {
        const bid = bids.find((row) => row.id === where.id);
        if (!bid) throw new Error('missing bid');
        Object.assign(bid, data);
        return bid;
      },
    },
    deliveryAssignment: {
      async findUnique({ where }: { where: { id?: string; idempotencyKey?: string } }) {
        return assignments.find((row) => where.id ? row.id === where.id : row.idempotencyKey === where.idempotencyKey) ?? null;
      },
      async findFirst({ where }: { where: { riderProfileId: string; status: AssignmentStatus } }) {
        return assignments.find((row) => row.riderProfileId === where.riderProfileId && row.status === where.status) ?? null;
      },
      async findMany({ where }: { where: { riderProfileId: string; status: AssignmentStatus } }) {
        return assignments.filter((row) => row.riderProfileId === where.riderProfileId && row.status === where.status);
      },
      async create({ data }: { data: Omit<AssignmentRow, 'id'> }) {
        if (assignments.some((row) => row.idempotencyKey === data.idempotencyKey)) throw uniqueViolation();
        const accepted = assignments.filter((row) => row.status === AssignmentStatus.ACCEPTED);
        if (data.status === AssignmentStatus.ACCEPTED && accepted.some((row) => row.deliveryId === data.deliveryId)) {
          throw uniqueViolation('delivery_assignments_one_accepted_per_delivery_idx');
        }
        const row = { id: `00000000-0000-7000-8000-${String(nextAssignment).padStart(12, '0')}`, ...data };
        nextAssignment += 1;
        assignments.push(row);
        return row;
      },
    },
    riderProfile: {
      async findUnique({ where }: { where: { id: string } }) {
        return profiles.find((row) => row.id === where.id) ?? null;
      },
      async update({ where, data }: { where: { id: string }; data: { availability: RiderAvailability } }) {
        const row = profiles.find((item) => item.id === where.id);
        if (!row) throw new Error('missing rider');
        Object.assign(row, data);
        return row;
      },
    },
    user: {
      async findUnique({ where }: { where: { id: string } }) {
        return users.find((row) => row.id === where.id) ?? null;
      },
    },
    motorcycle: {
      async findMany({ where }: { where: { riderProfileId: string } }) {
        return motorcycles.filter((row) => row.riderProfileId === where.riderProfileId);
      },
    },
    riderWallet: {
      async findUnique({ where }: { where: { riderProfileId: string } }) {
        return wallets.find((row) => row.riderProfileId === where.riderProfileId) ?? null;
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
      async findFirst({ where }: { where: { assignmentId: string } }) {
        return reservations.find((row) => row.assignmentId === where.assignmentId) ?? null;
      },
      async findMany({ where }: { where: { riderWalletId: string; status: string } }) {
        return reservations.filter((row) => row.riderWalletId === where.riderWalletId && row.status === where.status);
      },
      async create({ data }: { data: { riderWalletId: string; deliveryId: string; assignmentId: string; amount: string; configVersion: number } }) {
        if (state.failReservation) throw new Error('reservation failed');
        reservations.push({ id: `reservation-${reservations.length + 1}`, status: 'OPEN', ...data });
        return data;
      },
    },
    deliveryStatusEvent: {
      async create() {
        return {};
      },
    },
    v2OutboxEvent: {
      async create({ data }: { data: { assignmentId: string; eventType: string } }) {
        return data;
      },
    },
  };
  return {
    prisma: db as unknown as PrismaService,
    bids,
    deliveries,
    profiles,
    assignments,
    reservations,
    rates,
    wallets,
    get ledgerWrites() {
      return state.ledgerWrites;
    },
    get failReservation() {
      return state.failReservation;
    },
    set failReservation(value: boolean) {
      state.failReservation = value;
    },
  };
}

type DeliveryFixture = {
  id: string;
  customerId: string;
  status: DeliveryStatus;
  serviceClass: ServiceClass;
  deliverBy: Date | null;
  searchGeneration: number;
  currency: Currency;
  price: string | null;
  suggestedPrice: string;
};

function delivery(id: string): DeliveryFixture {
  return {
    id,
    customerId: 'account-1',
    status: DeliveryStatus.CREATED,
    serviceClass: ServiceClass.EXPRESS,
    deliverBy: DEADLINE,
    searchGeneration: 0,
    currency: Currency.USD,
    price: null,
    suggestedPrice: '9.00',
  };
}

function uniqueViolation(target = ''): Error {
  const error = new Error(target ? `Unique constraint failed on ${target}` : 'Unique constraint failed') as Error & {
    code: string;
    meta?: { target: string };
  };
  error.code = 'P2002';
  if (target) error.meta = { target };
  return error;
}
