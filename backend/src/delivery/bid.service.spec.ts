import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AccountStatus,
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
import { BidService } from './bid.service.js';
import { createPickupApproachCache } from './pickup-approach.js';

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

  it('rejects a new bid when receiving requests is paused and keeps the existing rows', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    ctx.profiles[0]!.receivingRequests = false;
    const bids = new BidService(ctx.prisma);
    await expect(bids.submit(RIDER_CONTEXT, bidBody(1_000), 'key-paused', NOW)).rejects.toThrow('You are not receiving requests');
    expect(ctx.bids).toHaveLength(0);
    ctx.profiles[0]!.receivingRequests = true;
    await expect(bids.submit(RIDER_CONTEXT, bidBody(1_000), 'key-paused', NOW)).resolves.toMatchObject({ status: 'OPEN' });
    expect(ctx.bids).toHaveLength(1);
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

  it('rejects a bid whose commission exceeds wallet capacity and still requires a published rate', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const short = store({ basisPoints: 10_000, borrowingLimit: '0.00' });
    short.wallets.splice(0, short.wallets.length);
    await expect(new BidService(short.prisma).submit(RIDER_CONTEXT, bidBody(5_000), 'short', NOW)).rejects.toThrow('Wallet capacity is not enough for this bid');
    expect(short.bids).toHaveLength(0);
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
    expect(page[0]).toMatchObject({
      amountCents: 1_500,
      rider: { name: 'Tendai Moyo', verified: true, completedDeliveries: 0, averageRating: null, ratingCount: 0, riderClass: 'SILVER', distanceMeters: null, motorcycle: 'Honda Ace', registrationNumber: 'AEX1234', hasProfilePhoto: false, pickupEtaSeconds: null },
    });
    expect(JSON.stringify(page)).not.toContain('+263');
    expect(JSON.stringify(page)).not.toContain('licence');
    await expect(bids.listForCustomer({ ...CUSTOMER, customerAccountId: 'other' }, DELIVERY, NOW)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('adds a fresh pickup distance and completed count, and omits a stale location', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    Object.assign(ctx.deliveries[0]!, { pickupLatitude: -17.8292, pickupLongitude: 31.0522 });
    ctx.locations.push(
      { riderProfileId: RIDER, latitude: -17.824, longitude: 31.05, updatedAt: NOW },
      { riderProfileId: OTHER_RIDER, latitude: -17.8, longitude: 31.04, updatedAt: new Date(NOW.getTime() - 61_000) },
    );
    ctx.profiles[0]!.completedDeliveryCount = 2;
    ctx.profilePhotos.push({ riderProfileId: RIDER });
    const bids = new BidService(ctx.prisma);
    await bids.submit(RIDER_CONTEXT, bidBody(1_500), 'key-1', NOW);
    await bids.submit({ userId: 'user-rider-2', riderProfileId: OTHER_RIDER }, bidBody(900), 'key-2', NOW);
    const page = await bids.listForCustomer(CUSTOMER, DELIVERY, NOW);
    const tendai = page.find((bid) => bid.rider.name === 'Tendai Moyo');
    const rudo = page.find((bid) => bid.rider.name === 'Rudo Ncube');
    expect(tendai?.rider.completedDeliveries).toBe(2);
    expect(tendai?.rider.averageRating).toBeNull();
    expect(tendai?.rider.ratingCount).toBe(0);
    expect(JSON.stringify(page)).not.toContain('4.8');
    expect(tendai?.rider.distanceMeters).toBeGreaterThan(0);
    expect(rudo?.rider.distanceMeters).toBeNull();
    expect(rudo?.rider.motorcycle).toBeNull();
    expect(rudo?.rider.registrationNumber).toBe('DEF5678');
    expect(tendai?.rider.registrationNumber).toBe('AEX1234');
    expect(tendai?.rider.hasProfilePhoto).toBe(true);
    expect(rudo?.rider.hasProfilePhoto).toBe(false);
    expect(tendai?.rider.pickupEtaSeconds).toBeNull();
    expect(rudo?.rider.pickupEtaSeconds).toBeNull();
    expect(tendai?.rider.mapPoint).toEqual({
      latitude: expect.any(Number),
      longitude: expect.any(Number),
    });
    expect(metresFrom(tendai?.rider.mapPoint, -17.824, 31.05)).toBeGreaterThan(0);
    expect(metresFrom(tendai?.rider.mapPoint, -17.824, 31.05)).toBeLessThan(45);
    expect(metresFrom(rudo?.rider.mapPoint, -17.8, 31.04)).toBeGreaterThan(0);
    expect(metresFrom(rudo?.rider.mapPoint, -17.8, 31.04)).toBeLessThan(45);
    expect(JSON.stringify(page)).not.toContain('profile-photos');
    expect(JSON.stringify(page)).not.toContain('-17.824');
  });

  it('returns road pickupEtaSeconds for fresh GPS and skips stale or missing GPS', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    Object.assign(ctx.deliveries[0]!, { pickupLatitude: -17.8292, pickupLongitude: 31.0522 });
    ctx.locations.push(
      { riderProfileId: RIDER, latitude: -17.824, longitude: 31.05, updatedAt: NOW },
      { riderProfileId: OTHER_RIDER, latitude: -17.8, longitude: 31.04, updatedAt: new Date(NOW.getTime() - 61_000) },
    );
    let calls = 0;
    const queries: string[] = [];
    const bids = new BidService(ctx.prisma, {
      async lookup(query) {
        calls += 1;
        queries.push(query.riderProfileId);
        return { metres: 2_400, seconds: 480, line: [[31.05, -17.824], [31.0522, -17.8292]] };
      },
    });
    await bids.submit(RIDER_CONTEXT, bidBody(1_500), 'key-1', NOW);
    await bids.submit({ userId: 'user-rider-2', riderProfileId: OTHER_RIDER }, bidBody(900), 'key-2', NOW);
    const page = await bids.listForCustomer(CUSTOMER, DELIVERY, NOW);
    const tendai = page.find((bid) => bid.rider.name === 'Tendai Moyo');
    const rudo = page.find((bid) => bid.rider.name === 'Rudo Ncube');
    expect(tendai?.rider.pickupEtaSeconds).toBe(480);
    expect(rudo?.rider.pickupEtaSeconds).toBeNull();
    expect(metresFrom(tendai?.rider.mapPoint, -17.824, 31.05)).toBeGreaterThan(0);
    expect(metresFrom(tendai?.rider.mapPoint, -17.824, 31.05)).toBeLessThan(45);
    expect(metresFrom(rudo?.rider.mapPoint, -17.8, 31.04)).toBeGreaterThan(0);
    expect(metresFrom(rudo?.rider.mapPoint, -17.8, 31.04)).toBeLessThan(45);
    expect(calls).toBe(1);
    expect(queries).toEqual([RIDER]);
    expect(JSON.stringify(page)).not.toContain('-17.824');
    expect(JSON.stringify(page)).not.toContain('"line"');
  });

  it('returns the privacy-safe marker before a slow pickup route finishes', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    Object.assign(ctx.deliveries[0]!, { pickupLatitude: -17.8292, pickupLongitude: 31.0522 });
    ctx.locations.push({ riderProfileId: RIDER, latitude: -17.824, longitude: 31.05, updatedAt: NOW });
    let release: ((value: { metres: number; seconds: number; line: number[][] }) => void) | undefined;
    const bids = new BidService(ctx.prisma, {
      lookup: () => new Promise((resolve) => {
        release = resolve;
      }),
    });
    await bids.submit(RIDER_CONTEXT, bidBody(1_500), 'key-1', NOW);
    const page = await Promise.race([
      bids.listForCustomer(CUSTOMER, DELIVERY, NOW),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('offers waited for the route')), 500);
      }),
    ]);
    expect(page[0]?.rider.pickupEtaSeconds).toBeNull();
    expect(metresFrom(page[0]?.rider.mapPoint, -17.824, 31.05)).toBeGreaterThan(0);
    expect(metresFrom(page[0]?.rider.mapPoint, -17.824, 31.05)).toBeLessThan(45);
    release?.({ metres: 100, seconds: 30, line: [] });
  });

  it('omits pickupEtaSeconds when routing fails or travel time is missing', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    Object.assign(ctx.deliveries[0]!, { pickupLatitude: -17.8292, pickupLongitude: 31.0522 });
    ctx.locations.push({ riderProfileId: RIDER, latitude: -17.824, longitude: 31.05, updatedAt: NOW });
    await new BidService(ctx.prisma, { lookup: async () => null }).submit(RIDER_CONTEXT, bidBody(1_500), 'fail', NOW);
    const failed = await new BidService(ctx.prisma, { lookup: async () => null }).listForCustomer(CUSTOMER, DELIVERY, NOW);
    expect(failed[0]?.rider.pickupEtaSeconds).toBeNull();
    const missingTime = await new BidService(ctx.prisma, {
      lookup: async () => ({ metres: 2_400, seconds: 0, line: [] }),
    }).listForCustomer(CUSTOMER, DELIVERY, NOW);
    expect(missingTime[0]?.rider.pickupEtaSeconds).toBeNull();
  });

  it('reuses cached pickup approaches across bid polls', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    Object.assign(ctx.deliveries[0]!, { pickupLatitude: -17.8292, pickupLongitude: 31.0522 });
    ctx.locations.push({ riderProfileId: RIDER, latitude: -17.824, longitude: 31.05, updatedAt: NOW });
    let calls = 0;
    const approach = createPickupApproachCache(async () => {
      calls += 1;
      return { metres: 1_800, seconds: 240.4, line: [] };
    }, () => NOW.getTime());
    const bids = new BidService(ctx.prisma, approach);
    await bids.submit(RIDER_CONTEXT, bidBody(1_500), 'key-1', NOW);
    const first = await bids.listForCustomer(CUSTOMER, DELIVERY, NOW);
    const second = await bids.listForCustomer(CUSTOMER, DELIVERY, NOW);
    expect(first[0]?.rider.pickupEtaSeconds).toBe(240);
    expect(second[0]?.rider.pickupEtaSeconds).toBe(240);
    expect(calls).toBe(1);
  });

  it('shares one in-flight route for concurrent identical bid lists', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    Object.assign(ctx.deliveries[0]!, { pickupLatitude: -17.8292, pickupLongitude: 31.0522 });
    ctx.locations.push({ riderProfileId: RIDER, latitude: -17.824, longitude: 31.05, updatedAt: NOW });
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const approach = createPickupApproachCache(async () => {
      calls += 1;
      await gate;
      return { metres: 1_200, seconds: 180, line: [] };
    }, () => NOW.getTime());
    const bids = new BidService(ctx.prisma, approach);
    await bids.submit(RIDER_CONTEXT, bidBody(1_500), 'key-1', NOW);
    const pending = Promise.all([
      bids.listForCustomer(CUSTOMER, DELIVERY, NOW),
      bids.listForCustomer(CUSTOMER, DELIVERY, NOW),
    ]);
    release();
    const [first, second] = await pending;
    expect(first[0]?.rider.pickupEtaSeconds).toBe(180);
    expect(second[0]?.rider.pickupEtaSeconds).toBe(180);
    expect(calls).toBe(1);
  });

  it('lists open bids without taking an exclusive delivery row lock', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    const bids = new BidService(ctx.prisma);
    await bids.submit(RIDER_CONTEXT, bidBody(1_500), 'key-1', NOW);
    ctx.rawQueries.length = 0;
    ctx.transactionOptions.length = 0;
    const page = await bids.listForCustomer(CUSTOMER, DELIVERY, NOW);
    expect(page).toHaveLength(1);
    expect(page[0]).toMatchObject({ status: BidStatus.OPEN, amountCents: 1_500 });
    expect(ctx.rawQueries.filter((sql) => /FOR UPDATE/i.test(sql))).toEqual([]);
    expect(ctx.transactionOptions).toEqual([{ maxWait: 10_000, timeout: 20_000 }]);
  });

  it('hides a dismissed bid from the customer list without withdrawing it', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    const bids = new BidService(ctx.prisma);
    const open = await bids.submit(RIDER_CONTEXT, bidBody(1_500), 'key-1', NOW);
    await bids.dismissForCustomer(CUSTOMER, DELIVERY, open.id, NOW);
    expect(ctx.bids[0]?.status).toBe(BidStatus.OPEN);
    expect(ctx.bids[0]?.customerDismissedAt).toEqual(NOW);
    expect(await bids.listForCustomer(CUSTOMER, DELIVERY, NOW)).toEqual([]);
  });

  it('keeps an open bid visible and accepts another bid while Express is live', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    const bids = new BidService(ctx.prisma);
    const open = await bids.submit(RIDER_CONTEXT, bidBody(1_500), 'key-1', NOW);
    ctx.expressRiders.add(RIDER);
    const listed = await bids.listForCustomer(CUSTOMER, DELIVERY, NOW);
    expect(listed.map((bid) => bid.id)).toEqual([open.id]);
    expect(ctx.bids.find((bid) => bid.id === open.id)?.status).toBe(BidStatus.OPEN);
    const other = '00000000-0000-7000-8000-0000000000d9';
    ctx.deliveries.push({ ...ctx.deliveries[0]!, id: other });
    const second = await bids.submit(RIDER_CONTEXT, { ...bidBody(900), deliveryId: other }, 'key-2', NOW);
    expect(second.deliveryId).toBe(other);
    expect(ctx.bids.filter((bid) => bid.riderProfileId === RIDER && bid.status === BidStatus.OPEN)).toHaveLength(2);
  });

  it('lists an open request without contact phones and hides it after the deadline', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    const bids = new BidService(ctx.prisma);
    const open = await bids.listOpenRequests(RIDER_CONTEXT, NOW);
    expect(open).toEqual([expect.objectContaining({
      id: DELIVERY,
      serviceClass: 'FLEXIBLE',
      suggestedPrice: '9.00',
      offeredPrice: '7.50',
      pickupAddress: '12 Samora Machel Avenue',
    })]);
    expect(JSON.stringify(open)).not.toContain('+263');
    await expect(bids.requestRoad(RIDER_CONTEXT, DELIVERY)).resolves.toEqual({ line: [] });
    ctx.deliveries[0]!.deliverBy = new Date(NOW.getTime() - 1_000);
    await expect(bids.listOpenRequests(RIDER_CONTEXT, NOW)).resolves.toEqual([]);
    ctx.deliveries[0]!.status = DeliveryStatus.CREATED;
    ctx.deliveries[0]!.deliverBy = null;
    const openEnded = await bids.listOpenRequests(RIDER_CONTEXT, NOW);
    expect(openEnded.map((request) => request.id)).toEqual([DELIVERY]);
    expect(openEnded[0]?.deliverBy).toBeNull();
    const submitted = await bids.submit(RIDER_CONTEXT, bidBody(900), 'open-ended', NOW);
    expect(submitted.deliveryId).toBe(DELIVERY);
    expect(ctx.bids.filter((bid) => bid.status === BidStatus.OPEN)).toHaveLength(1);
  });

  it('hides open requests from a rider who is unapproved or offline', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    const bids = new BidService(ctx.prisma);
    ctx.profiles[0]!.approvalStatus = RiderApprovalStatus.PENDING;
    ctx.profiles[0]!.availability = RiderAvailability.OFFLINE;
    ctx.profiles[0]!.receivingRequests = false;
    await expect(bids.listOpenRequests(RIDER_CONTEXT, NOW)).resolves.toEqual([]);
    ctx.profiles[0]!.approvalStatus = RiderApprovalStatus.APPROVED;
    await expect(bids.listOpenRequests(RIDER_CONTEXT, NOW)).resolves.toEqual([]);
    ctx.profiles[0]!.availability = RiderAvailability.AVAILABLE;
    ctx.profiles[0]!.receivingRequests = true;
    const open = await bids.listOpenRequests(RIDER_CONTEXT, NOW);
    expect(open.map((request) => request.id)).toEqual([DELIVERY]);
  });

  it('records Express interest and a different offer without assigning the rider', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    ctx.deliveries[0]!.serviceClass = ServiceClass.EXPRESS;
    const bids = new BidService(ctx.prisma);
    const counteroffer = await bids.submit(RIDER_CONTEXT, bidBody(1_000), 'wrong-price', NOW);
    expect(counteroffer).toMatchObject({ amount: '10.00', status: 'OPEN' });
    expect(ctx.deliveries[0]?.status).toBe(DeliveryStatus.CREATED);
    const interest = await bids.submit(
      { userId: 'user-rider-2', riderProfileId: OTHER_RIDER },
      bidBody(900),
      'interest-2',
      NOW,
    );
    expect(interest).toMatchObject({ amount: '9.00', status: 'OPEN' });
    expect(ctx.deliveries[0]?.status).toBe(DeliveryStatus.CREATED);
    expect(ctx.reservationWrites).toBe(0);
    await expect(bids.submit(RIDER_CONTEXT, bidBody(900), 'interest-3', NOW)).rejects.toThrow(
      'This rider already has an open bid',
    );
  });

  it('gives bid submit the same 20-second interactive timeout as acceptance', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    const bids = new BidService(ctx.prisma);
    await bids.submit(RIDER_CONTEXT, bidBody(1_000), 'timeout-options', NOW);
    expect(ctx.transactionOptions.length).toBeGreaterThanOrEqual(2);
    expect(ctx.transactionOptions.every((options) => options?.timeout === 20_000 && options?.maxWait === 10_000)).toBe(true);
  });

  it('returns a conflict instead of a 500 when bid submit cannot commit in time', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    ctx.failSubmitCommit = true;
    const bids = new BidService(ctx.prisma);
    await expect(bids.submit(RIDER_CONTEXT, bidBody(1_000), 'slow-commit', NOW)).rejects.toBeInstanceOf(ConflictException);
    await expect(bids.submit(RIDER_CONTEXT, bidBody(1_000), 'slow-commit', NOW)).rejects.toThrow('The bid could not be saved. Try again.');
    expect(ctx.bids).toHaveLength(0);
  });

  it('keeps acceptance of the customer price and a counteroffer open without assignment', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    const bids = new BidService(ctx.prisma);
    const accepted = await bids.submit(RIDER_CONTEXT, bidBody(750), 'customer-price', NOW);
    const counteroffer = await bids.submit(
      { userId: 'user-rider-2', riderProfileId: OTHER_RIDER },
      bidBody(800),
      'counteroffer',
      NOW,
    );
    expect(accepted).toMatchObject({ amount: '7.50', status: 'OPEN' });
    expect(counteroffer).toMatchObject({ amount: '8.00', status: 'OPEN' });
    expect(ctx.bids.map((bid) => bid.status)).toEqual([BidStatus.OPEN, BidStatus.OPEN]);
    expect(ctx.deliveries[0]?.status).toBe(DeliveryStatus.CREATED);
    expect(ctx.assignmentWrites).toBe(0);
    expect(ctx.reservationWrites).toBe(0);
  });

  it('records a Flexible bid without assigning the rider', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = store();
    const bids = new BidService(ctx.prisma);
    const first = await bids.submit(RIDER_CONTEXT, bidBody(1_200), 'flex-1', NOW);
    const second = await bids.submit(
      { userId: 'user-rider-2', riderProfileId: OTHER_RIDER },
      bidBody(1_400),
      'flex-2',
      NOW,
    );
    expect(first).toMatchObject({ amount: '12.00', status: 'OPEN' });
    expect(second).toMatchObject({ amount: '14.00', status: 'OPEN' });
    expect(ctx.deliveries[0]?.status).toBe(DeliveryStatus.CREATED);
    expect(ctx.reservationWrites).toBe(0);
    expect(ctx.bids.filter((bid) => bid.status === BidStatus.OPEN)).toHaveLength(2);
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
  customerDismissedAt?: Date | null;
};

type Profile = {
  id: string;
  userId: string;
  approvalStatus: RiderApprovalStatus;
  verificationStatus: RiderVerificationStatus;
  availability: RiderAvailability;
  receivingRequests: boolean | null;
  completedDeliveryCount: number;
  ratingCount: number;
  ratingSum: number;
  riderClass: 'SILVER' | 'GOLD' | 'PLATINUM';
};

function metresFrom(point: { latitude: number; longitude: number } | null | undefined, latitude: number, longitude: number): number {
  if (!point) {
    return Number.POSITIVE_INFINITY;
  }
  const north = (point.latitude - latitude) * 111_320;
  const east = (point.longitude - longitude) * 111_320 * Math.cos((latitude * Math.PI) / 180);
  return Math.hypot(north, east);
}

function store(options?: { basisPoints?: number; borrowingLimit?: string; rate?: boolean }) {
  const bids: BidRow[] = [];
  const flexibleClass: ServiceClass = ServiceClass.FLEXIBLE;
  const deliveries: Array<{
    id: string;
    customerId: string;
    status: DeliveryStatus;
    serviceClass: ServiceClass;
    deliverBy: Date | null;
    searchGeneration: number;
    currency: Currency;
    suggestedPrice: string;
    customerOffer: string;
    distanceMeters: number;
    pickupAddress: string;
    dropoffAddress: string;
    parcelDescription: string;
    parcelSize: string;
    pickupContactPhone: string;
  }> = [{
    id: DELIVERY,
    customerId: 'account-1',
    status: DeliveryStatus.CREATED,
    serviceClass: flexibleClass,
    deliverBy: DEADLINE as Date | null,
    searchGeneration: 0,
    currency: Currency.USD,
    suggestedPrice: '9.00',
    customerOffer: '7.50',
    distanceMeters: 1_200,
    pickupAddress: '12 Samora Machel Avenue',
    dropoffAddress: '4 Jason Moyo Avenue',
    parcelDescription: 'Documents',
    parcelSize: 'SMALL',
    pickupContactPhone: '+263771234567',
  }];
  const profiles: Profile[] = [
    { id: RIDER, userId: 'user-rider', approvalStatus: RiderApprovalStatus.APPROVED, verificationStatus: RiderVerificationStatus.VERIFIED, availability: RiderAvailability.AVAILABLE, receivingRequests: true, completedDeliveryCount: 0, ratingCount: 0, ratingSum: 0, riderClass: 'SILVER' },
    { id: OTHER_RIDER, userId: 'user-rider-2', approvalStatus: RiderApprovalStatus.APPROVED, verificationStatus: RiderVerificationStatus.VERIFIED, availability: RiderAvailability.AVAILABLE, receivingRequests: true, completedDeliveryCount: 0, ratingCount: 0, ratingSum: 0, riderClass: 'SILVER' },
  ];
  const users = [
    { id: 'user-rider', accountStatus: AccountStatus.ACTIVE, phoneVerifiedAt: NOW, fullName: 'Tendai Moyo', phone: '+263771234567' },
    { id: 'user-rider-2', accountStatus: AccountStatus.ACTIVE, phoneVerifiedAt: NOW, fullName: 'Rudo Ncube', phone: '+263777654321' },
  ];
  const motorcycles = [
    { id: 'bike-1', riderProfileId: RIDER, verificationStatus: MotorcycleVerificationStatus.VERIFIED, isActive: true, make: 'Honda', model: 'Ace', registrationNumber: 'AEX1234' },
    { id: 'bike-2', riderProfileId: OTHER_RIDER, verificationStatus: MotorcycleVerificationStatus.VERIFIED, isActive: true, make: null, model: null, registrationNumber: 'DEF5678' },
  ];
  const wallets = [
    { id: 'wallet-1', riderProfileId: RIDER, balance: '0.00', borrowingLimitOverride: null },
    { id: 'wallet-2', riderProfileId: OTHER_RIDER, balance: '0.00', borrowingLimitOverride: null },
  ];
    const expressRiders = new Set<string>();
    const locations: Array<{ riderProfileId: string; latitude: number; longitude: number; updatedAt: Date }> = [];
    const completedAssignments: Array<{ riderProfileId: string }> = [];
    const profilePhotos: Array<{ riderProfileId: string }> = [];
  const rates = options?.rate === false ? [] : [{ isActive: true, basisPoints: options?.basisPoints ?? 1_000, rateVersion: 1 }];
  const config = { isActive: true, defaultBorrowingLimit: options?.borrowingLimit ?? '50.00' };
  let reservationWrites = 0;
  let ledgerWrites = 0;
  let assignmentWrites = 0;
  let failSubmitCommit = false;
  let nextBid = 1;
  let queue = Promise.resolve();
  const rawQueries: string[] = [];
  const transactionOptions: Array<{ maxWait?: number; timeout?: number } | undefined> = [];
  const db = {
    async $transaction<T>(fn: (tx: object) => Promise<T>, options?: { maxWait?: number; timeout?: number }): Promise<T> {
      transactionOptions.push(options);
      const previous = queue;
      let release = () => {};
      queue = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      const backup = bids.map((bid) => ({ ...bid }));
      try {
        const result = await fn(db);
        if (failSubmitCommit) {
          throw transactionTimeout();
        }
        return result;
      } catch (error) {
        bids.splice(0, bids.length, ...backup);
        throw error;
      } finally {
        release();
      }
    },
    async $queryRaw(strings: TemplateStringsArray) {
      rawQueries.push(strings.join(' '));
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
      async findMany({ where }: { where: { status: DeliveryStatus; deliverBy?: { gt?: Date; lte?: Date }; searchGeneration: number; OR?: Array<{ deliverBy: null | { gt?: Date } }> } }) {
        return deliveries.filter((delivery) => (
          delivery.status === where.status
          && delivery.serviceClass != null
          && delivery.searchGeneration === where.searchGeneration
          && (where.deliverBy?.gt ? delivery.deliverBy != null && delivery.deliverBy > where.deliverBy.gt : true)
          && (where.deliverBy?.lte ? delivery.deliverBy != null && delivery.deliverBy.getTime() <= where.deliverBy.lte.getTime() : true)
          && (where.OR ? where.OR.some((clause) => (
            clause.deliverBy === null
              ? delivery.deliverBy == null
              : delivery.deliverBy != null && clause.deliverBy.gt != null && delivery.deliverBy > clause.deliverBy.gt
          )) : true)
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
      async findMany({ where }: { where: { deliveryId: string; status: BidStatus; customerDismissedAt?: null } }) {
        return bids
          .filter((bid) => (
            bid.deliveryId === where.deliveryId
            && bid.status === where.status
            && (where.customerDismissedAt === undefined || bid.customerDismissedAt == null)
          ))
          .map((bid) => withRider(bid));
      },
      async updateMany({ where, data }: { where: { status: BidStatus; deliveryId?: string; delivery?: { deliverBy: { lte: Date } } }; data: { status: BidStatus } }) {
        for (const bid of bids) {
          const delivery = deliveries.find((item) => item.id === bid.deliveryId);
          const due = !where.delivery || (delivery?.deliverBy != null && delivery.deliverBy.getTime() <= where.delivery.deliverBy.lte.getTime());
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
      async update({ where, data }: { where: { id: string }; data: { status?: BidStatus; customerDismissedAt?: Date } }) {
        const row = bids.find((bid) => bid.id === where.id);
        if (!row) {
          throw new Error('missing bid');
        }
        Object.assign(row, data);
        return row;
      },
    },
    riderProfilePhoto: {
      async findMany({ where }: { where: { riderProfileId: { in: string[] } } }) {
        const ids = new Set(where.riderProfileId.in);
        return profilePhotos.filter((row) => ids.has(row.riderProfileId));
      },
    },
    riderLocation: {
      async findMany({ where }: { where: { riderProfileId: { in: string[] } } }) {
        const ids = new Set(where.riderProfileId.in);
        return locations.filter((row) => ids.has(row.riderProfileId));
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
      async findMany({ where }: { where: { riderProfileId: string | { in?: string[] }; isActive?: boolean; verificationStatus?: MotorcycleVerificationStatus } }) {
        const ids = typeof where.riderProfileId === 'string' ? [where.riderProfileId] : where.riderProfileId.in ?? [];
        return motorcycles.filter((motorcycle) => (
          ids.includes(motorcycle.riderProfileId)
          && (where.isActive === undefined || motorcycle.isActive === where.isActive)
          && (where.verificationStatus === undefined || motorcycle.verificationStatus === where.verificationStatus)
        ));
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
      async findMany({ where }: { where?: { riderProfileId?: { in?: string[] }; serviceClass?: ServiceClass; delivery?: { status: DeliveryStatus } } }) {
        const ids = where?.riderProfileId?.in ?? [];
        if (where?.delivery?.status === DeliveryStatus.DELIVERED) {
          return completedAssignments.filter((row) => ids.includes(row.riderProfileId));
        }
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
    locations,
    completedAssignments,
    profilePhotos,
    rawQueries,
    transactionOptions,
    set failSubmitCommit(value: boolean) {
      failSubmitCommit = value;
    },
  };

  function withRider(bid: BidRow) {
    const profile = profiles.find((item) => item.id === bid.riderProfileId);
    const user = users.find((item) => item.id === profile?.userId);
    return {
      ...bid,
      riderProfile: {
        verificationStatus: profile?.verificationStatus,
        completedDeliveryCount: profile?.completedDeliveryCount ?? 0,
        ratingCount: profile?.ratingCount ?? 0,
        ratingSum: profile?.ratingSum ?? 0,
        riderClass: profile?.riderClass ?? 'SILVER',
        user: { fullName: user?.fullName ?? '' },
      },
    };
  }
}

function uniqueViolation(): Error {
  const error = new Error('Unique constraint failed');
  (error as Error & { code: string }).code = 'P2002';
  return error;
}

function transactionTimeout(): Error {
  const error = new Error('A commit cannot be executed on an expired transaction');
  (error as Error & { code: string }).code = 'P2028';
  return error;
}
