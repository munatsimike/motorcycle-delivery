import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { straightLineMetres } from './straight-line.js';
import { GPS_FRESH_MS } from './dispatch.constants.js';
import { DispatchService } from './dispatch.service.js';
import { formatSignedCents } from '../rider/wallet-money.js';

const NOW = new Date('2026-10-14T12:00:00.000Z');
const CUSTOMER = { userId: 'user-customer', role: 'CUSTOMER' as const, customerAccountId: 'account-1' };

describe('progressive dispatch', () => {
  it('does not search a delivery that is not Express or Flexible', async () => {
    const ctx = context();
    const created = addDelivery(ctx, 'created-v1');
    const exhausted = addDelivery(ctx, 'exhausted-v1');
    exhausted.status = 'NO_RIDER_FOUND';
    exhausted.searchGeneration = 6;

    await expect(ctx.service.search(CUSTOMER, created.id, NOW)).rejects.toThrow('This delivery cannot be searched');
    await expect(ctx.service.search(CUSTOMER, exhausted.id, NOW)).rejects.toThrow('This delivery cannot be searched');

    expect(ctx.deliveries.find((row) => row.id === created.id)).toMatchObject({ status: 'CREATED', searchGeneration: 0 });
    expect(ctx.deliveries.find((row) => row.id === exhausted.id)).toMatchObject({ status: 'NO_RIDER_FOUND', searchGeneration: 6 });
    expect(ctx.rounds).toHaveLength(0);
    expect(ctx.assignments).toHaveLength(0);
  });


  it('leaves a stored legacy assignment unchanged when progress or cancellation is requested', async () => {
    const ctx = context();
    const courier = addRider(ctx, 'stored', longitudeFor(500), fresh(NOW));
    const delivery = addDelivery(ctx, 'stored-legacy');
    seedAccepted(ctx, delivery, courier.id);

    await expect(ctx.service.progress(rider(courier.id), delivery.id, { status: 'ARRIVED_AT_PICKUP' }, NOW))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(ctx.service.cancel(CUSTOMER, delivery.id, NOW))
      .rejects.toBeInstanceOf(ConflictException);

    expect(ctx.deliveries.find((row) => row.id === delivery.id)?.status).toBe('ASSIGNED');
    expect(ctx.assignments.find((row) => row.deliveryId === delivery.id)?.status).toBe('ACCEPTED');
    expect(ctx.reservations[0]?.status).toBe('OPEN');
    expect(ctx.events.filter((event) => event.newStatus === 'ARRIVED_AT_PICKUP' || event.newStatus === 'CANCELLED')).toHaveLength(0);
  });

  it('cancels a delivery when no rider was found', async () => {
    const ctx = context();
    const delivery = addDelivery(ctx, 'delivery-exhausted');
    delivery.status = 'NO_RIDER_FOUND';

    await ctx.service.cancel(CUSTOMER, delivery.id, NOW);

    expect(ctx.deliveries[0]?.status).toBe('CANCELLED');
  });

  it('closes open bids when the customer cancels before choosing a rider', async () => {
    const ctx = context();
    const openEnded = addDelivery(ctx, 'open-ended');
    openEnded.serviceClass = 'FLEXIBLE';
    openEnded.deliverBy = null;
    const other = addDelivery(ctx, 'still-open');
    other.serviceClass = 'FLEXIBLE';
    other.deliverBy = null;
    ctx.bids.push(
      { id: 'open-1', deliveryId: openEnded.id, status: 'OPEN' },
      { id: 'open-2', deliveryId: openEnded.id, status: 'OPEN' },
      { id: 'kept-accepted', deliveryId: openEnded.id, status: 'ACCEPTED' },
      { id: 'kept-superseded', deliveryId: openEnded.id, status: 'SUPERSEDED' },
      { id: 'other-open', deliveryId: other.id, status: 'OPEN' },
    );

    await ctx.service.cancel(CUSTOMER, openEnded.id, NOW);

    expect(ctx.deliveries.find((row) => row.id === openEnded.id)?.status).toBe('CANCELLED');
    expect(ctx.bids.filter((bid) => bid.deliveryId === openEnded.id && bid.status === 'OPEN')).toHaveLength(0);
    expect(ctx.bids.find((bid) => bid.id === 'open-1')?.status).toBe('EXPIRED');
    expect(ctx.bids.find((bid) => bid.id === 'open-2')?.status).toBe('EXPIRED');
    expect(ctx.bids.find((bid) => bid.id === 'kept-accepted')?.status).toBe('ACCEPTED');
    expect(ctx.bids.find((bid) => bid.id === 'kept-superseded')?.status).toBe('SUPERSEDED');
    expect(ctx.bids.find((bid) => bid.id === 'other-open')?.status).toBe('OPEN');
    expect(ctx.deliveries.find((row) => row.id === other.id)?.status).toBe('CREATED');
  });

  it('updates only the customer offer while no rider was found', async () => {
    const ctx = context();
    const delivery = noRider(ctx);
    await withMarketplace(async () => {
      await expect(ctx.service.adjustOffer(CUSTOMER, delivery.id, { offeredPrice: '0.01' }, NOW)).resolves.toEqual({ customerOffer: '0.01' });
      await expect(ctx.service.adjustOffer(CUSTOMER, delivery.id, { offeredPrice: '1000.00' }, NOW)).resolves.toEqual({ customerOffer: '1000.00' });
      await expect(ctx.service.adjustOffer(CUSTOMER, delivery.id, { offeredPrice: '6.50' }, NOW)).resolves.toEqual({ customerOffer: '6.50' });
    });
    expect(ctx.deliveries.find((row) => row.id === delivery.id)).toMatchObject({
      status: 'NO_RIDER_FOUND',
      customerOffer: '6.50',
      suggestedPrice: '8.88',
      price: '4.50',
    });
    expect(ctx.events).toHaveLength(0);
  });

  it('rejects an offer outside the existing price rules', async () => {
    const ctx = context();
    const delivery = noRider(ctx);
    await withMarketplace(async () => {
      for (const offeredPrice of ['0.00', '1000.01', '6.5', '']) {
        await expect(ctx.service.adjustOffer(CUSTOMER, delivery.id, { offeredPrice }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      }
    });
    expect(ctx.deliveries.find((row) => row.id === delivery.id)?.customerOffer).toBe('4.00');
  });

  it('rejects a price change from another customer', async () => {
    const ctx = context();
    const delivery = noRider(ctx);
    await withMarketplace(async () => {
      await expect(ctx.service.adjustOffer(
        { ...CUSTOMER, customerAccountId: 'other-account' },
        delivery.id,
        { offeredPrice: '6.00' },
        NOW,
      )).rejects.toBeInstanceOf(NotFoundException);
    });
    expect(ctx.deliveries.find((row) => row.id === delivery.id)?.customerOffer).toBe('4.00');
  });

  it('rejects a price change after assignment, cancellation, retry, or the deadline', async () => {
    await withMarketplace(async () => {
      for (const status of ['CANCELLED', 'RIDER_ASSIGNED', 'CREATED']) {
        const ctx = context();
        const delivery = noRider(ctx);
        delivery.status = status;
        await expect(ctx.service.adjustOffer(CUSTOMER, delivery.id, { offeredPrice: '6.00' }, NOW)).rejects.toBeInstanceOf(ConflictException);
        expect(ctx.deliveries.find((row) => row.id === delivery.id)?.customerOffer).toBe('4.00');
      }
      const expired = context();
      const closed = noRider(expired);
      closed.deliverBy = new Date(NOW.getTime() - 1_000);
      await expect(expired.service.adjustOffer(CUSTOMER, closed.id, { offeredPrice: '6.00' }, NOW)).rejects.toBeInstanceOf(ConflictException);
      const assigned = context();
      const taken = noRider(assigned);
      assigned.assignments.push({ id: 'assignment-1', deliveryId: taken.id, status: 'ACCEPTED' });
      await expect(assigned.service.adjustOffer(CUSTOMER, taken.id, { offeredPrice: '6.00' }, NOW)).rejects.toBeInstanceOf(ConflictException);
      expect(assigned.deliveries.find((row) => row.id === taken.id)?.customerOffer).toBe('4.00');
    });
  });

  it('restarts search with the updated customer offer', async () => {
    const ctx = context();
    const delivery = noRider(ctx);
    await withMarketplace(async () => {
      await ctx.service.adjustOffer(CUSTOMER, delivery.id, { offeredPrice: '6.50' }, NOW);
      await ctx.service.search(CUSTOMER, delivery.id, NOW);
    });
    expect(ctx.deliveries.find((row) => row.id === delivery.id)).toMatchObject({
      status: 'CREATED',
      customerOffer: '6.50',
      suggestedPrice: '8.88',
      price: '4.50',
    });
  });

  it('keeps the offer consistent when search and a price change overlap', async () => {
    const ctx = context();
    const delivery = noRider(ctx);
    const [adjusted, searched] = await withMarketplace(() => Promise.allSettled([
      ctx.service.adjustOffer(CUSTOMER, delivery.id, { offeredPrice: '6.00' }, NOW),
      ctx.service.search(CUSTOMER, delivery.id, NOW),
    ]));
    const row = ctx.deliveries.find((item) => item.id === delivery.id);
    expect(searched?.status).toBe('fulfilled');
    expect(row).toMatchObject({ status: 'CREATED', suggestedPrice: '8.88', price: '4.50' });
    if (adjusted?.status === 'fulfilled') {
      expect(adjusted.value).toEqual({ customerOffer: '6.00' });
      expect(row?.customerOffer).toBe('6.00');
    } else {
      expect(adjusted?.reason).toBeInstanceOf(ConflictException);
      expect(row?.customerOffer).toBe('4.00');
    }
  });

  it('keeps the fresh location window used by tracking', () => {
    expect(GPS_FRESH_MS).toBe(60_000);
  });
});

type Row = Record<string, any>;

function context() {
  const committed = emptyState();
  const lockLog: string[] = [];
  const heldRounds = new Set<string>();
  const heldDeliveries = new Set<string>();
  const mutexes = new Map<string, Mutex>();
  let sequence = 1;
  let txSeq = 1;

  function commit(base: State, draft: State): void {
    const changes: Array<{ rows: Row[]; id: string; row: Row; insert: boolean }> = [];
    for (const key of STATE_KEYS) {
      const idField = key === 'locations' ? 'riderProfileId' : 'id';
      for (const row of draft[key]) {
        const id = String(row[idField]);
        const before = base[key].find((item) => item[idField] === row[idField]);
        if (before && stable(before) === stable(row)) {
          continue;
        }
        const current = committed[key].find((item) => item[idField] === row[idField]);
        if (!before) {
          if (current) {
            throw new Error('commit conflict');
          }
          changes.push({ rows: committed[key], id, row, insert: true });
          continue;
        }
        if (!current || stable(current) !== stable(before)) {
          throw new Error('commit conflict');
        }
        changes.push({ rows: committed[key], id, row, insert: false });
      }
    }
    for (const change of changes) {
      if (change.insert) {
        change.rows.push(structuredClone(change.row));
      } else {
        const index = change.rows.findIndex((item) => String(item.id ?? item.riderProfileId) === change.id);
        change.rows[index] = structuredClone(change.row);
      }
    }
  }

  const prisma = {
    async $transaction(fn: (tx: unknown) => Promise<unknown>) {
      const txId = txSeq;
      txSeq += 1;
      let base = structuredClone(committed);
      let draft = structuredClone(committed);
      let dirty = false;
      const releases: Array<() => void> = [];
      const mark = () => {
        dirty = true;
      };
      const refresh = () => {
        if (dirty) {
          return;
        }
        base = structuredClone(committed);
        draft = structuredClone(committed);
      };
      const tx = {
        async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
          const sql = strings.join(' ');
          if (sql.includes('SKIP LOCKED') && sql.includes("'CREATED'") && sql.includes('search_generation')) {
            const eligible = draft.deliveries
              .filter((delivery) => delivery.status === 'CREATED' && delivery.searchGeneration === 0 && delivery.serviceClass == null)
              .filter((delivery) => !draft.rounds.some((round) => round.deliveryId === delivery.id))
              .filter((delivery) => !draft.assignments.some(
                (offer) => offer.deliveryId === delivery.id && offer.status === 'OFFERED',
              ))
              .filter((delivery) => !heldDeliveries.has(String(delivery.id)))
              .sort((left, right) => String(left.id).localeCompare(String(right.id)));
            const picked = eligible[0];
            if (!picked) {
              return [];
            }
            heldDeliveries.add(String(picked.id));
            releases.push(() => heldDeliveries.delete(String(picked.id)));
            await hold(mutexes, `delivery:${String(picked.id)}`, txId, releases);
            refresh();
            const current = draft.deliveries.find((delivery) => delivery.id === picked.id);
            if (!current || current.status !== 'CREATED' || current.searchGeneration !== 0) {
              return [];
            }
            if (draft.rounds.some((round) => round.deliveryId === current.id)) {
              return [];
            }
            return [{ id: current.id }];
          }

          if (sql.includes('SKIP LOCKED') && sql.includes('FROM "deliveries" d')) {
            const now = values[0] as Date;
            const eligible = draft.deliveries
              .filter((delivery) => delivery.status === 'SEARCHING' && delivery.searchGeneration > 0 && delivery.serviceClass == null)
              .filter((delivery) => !draft.rounds.some(
                (round) => round.deliveryId === delivery.id && round.status === 'PENDING',
              ))
              .filter((delivery) => !draft.assignments.some(
                (offer) => offer.deliveryId === delivery.id
                  && offer.status === 'OFFERED'
                  && offer.offerExpiresAt > now,
              ))
              .filter((delivery) => !delivery.nextRetryAt || delivery.nextRetryAt <= now)
              .sort((a, b) => String(a.id).localeCompare(String(b.id)));

            return eligible.length ? [{ id: eligible[0].id }] : [];
          }

          if (sql.includes('SKIP LOCKED')) {
            const now = values[0] as Date;
            const due = draft.rounds
              .filter((row) => row.status === 'PENDING' && row.dueAt <= now && !heldRounds.has(String(row.id)))
              .sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime() || String(left.id).localeCompare(String(right.id)));
            const picked = due[0];
            if (!picked) {
              return [];
            }
            heldRounds.add(String(picked.id));
            releases.push(() => heldRounds.delete(String(picked.id)));
            return [{ id: picked.id }];
          }
          if (sql.includes('ST_DWithin')) {
            const freshAfter = values[0] as Date;
            const longitude = Number(values[1]);
            const latitude = Number(values[2]);
            const radius = Number(values[3]);
            return draft.locations
              .filter((location) => location.updatedAt > freshAfter)
              .filter((location) => straightLineMetres(
                latitude,
                longitude,
                Number(location.latitude),
                Number(location.longitude),
              ) <= radius)
              .map((location) => ({ riderProfileId: location.riderProfileId }));
          }
          if (sql.includes('FOR UPDATE') && sql.includes('"deliveries"')) {
            lockLog.push('delivery');
            await hold(mutexes, `delivery:${String(values[0])}`, txId, releases);
            refresh();
            return [];
          }
          if (sql.includes('FOR UPDATE') && sql.includes('"rider_profiles"')) {
            lockLog.push('profile');
            await hold(mutexes, `profile:${String(values[0])}`, txId, releases);
            refresh();
            return [];
          }
          if (sql.includes('FOR UPDATE') && sql.includes('"delivery_assignments"')) {
            lockLog.push('assignment');
            await hold(mutexes, `assignment:${String(values[0])}`, txId, releases);
            refresh();
            return [];
          }
          if (sql.includes('FOR UPDATE') && sql.includes('"rider_wallets"')) {
            lockLog.push('wallet');
            await hold(mutexes, `wallet:${String(values[0])}`, txId, releases);
            refresh();
            return [];
          }
          return [];
        },
        delivery: table(() => draft.deliveries, mark, () => sequence++),
        deliveryAssignment: assignmentTable(() => draft.assignments, mark, () => sequence++),
        deliveryStatusEvent: table(() => draft.events, mark, () => sequence++),
        bid: bidTable(() => draft.bids, mark),
        riderProfile: table(() => draft.profiles, mark, () => sequence++),
        riderLocation: table(() => draft.locations, mark, () => sequence++),
        user: table(() => draft.users, mark, () => sequence++),
        motorcycle: table(() => draft.motorcycles, mark, () => sequence++),
        riderWallet: table(() => draft.wallets, mark, () => sequence++),
        riderWalletEntry: {
          ...table(() => draft.entries, mark, () => sequence++),
          async aggregate({ where }: { where?: Row }) {
            const rows = draft.entries.filter((row) => matches(row, where));
            if (rows.length === 0) {
              return { _sum: { amount: null } };
            }
            const total = rows.reduce((sum, row) => sum + cents(row.amount), 0);
            return { _sum: { amount: formatSignedCents(total) } };
          },
        },
        commissionPolicy: {
          async findFirst() {
            return {
              id: 'test-commission-policy',
              policyVersion: 1,
              model: process.env.TEST_COMMISSION_MODEL === 'ON_ACCEPTANCE' ? 'ON_ACCEPTANCE' : 'ON_COMPLETION',
              isActive: true,
            };
          },
        },
        walletConfig: table(() => draft.configs, mark, () => sequence++),
        walletFeeReservation: reservationTable(() => draft.reservations, mark, () => sequence++),
        customerAccount: {
          async findUnique({ where }: { where: { id?: string } }) {
            if (where.id === CUSTOMER.customerAccountId) {
              return { id: CUSTOMER.customerAccountId, userId: CUSTOMER.userId };
            }
            return null;
          },
        },
      };
      try {
        const result = await fn(tx);
        commit(base, draft);
        return result;
      } finally {
        for (const release of releases.reverse()) {
          release();
        }
      }
    },
  };

  return {
    service: new DispatchService(prisma as unknown as PrismaService),
    prisma: prisma as unknown as PrismaService,
    lockLog,
    get deliveries() { return committed.deliveries; },
    get assignments() { return committed.assignments; },
    get notifications() { return committed.notifications; },
    get rounds() { return committed.rounds; },
    get profiles() { return committed.profiles; },
    get wallets() { return committed.wallets; },
    get reservations() { return committed.reservations; },
    get entries() { return committed.entries; },
    get events() { return committed.events; },
    get bids() { return committed.bids; },
    get configs() { return committed.configs; },
    get locations() { return committed.locations; },
    get users() { return committed.users; },
    get motorcycles() { return committed.motorcycles; },
  };
}

function noRider(ctx: ReturnType<typeof context>, id = 'no-rider') {
  const delivery = addDelivery(ctx, id);
  delivery.status = 'NO_RIDER_FOUND';
  delivery.serviceClass = 'EXPRESS';
  delivery.customerOffer = '4.00';
  delivery.suggestedPrice = '8.88';
  delivery.price = '4.50';
  delivery.deliverBy = null;
  return delivery;
}

async function withMarketplace<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.V2_MARKETPLACE_ENABLED;
  process.env.V2_MARKETPLACE_ENABLED = 'true';
  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env.V2_MARKETPLACE_ENABLED;
    } else {
      process.env.V2_MARKETPLACE_ENABLED = previous;
    }
  }
}

function addDelivery(ctx: ReturnType<typeof context>, id = 'delivery-1') {
  const row = {
    id,
    customerId: CUSTOMER.customerAccountId,
    status: 'CREATED',
    searchGeneration: 0,
    autoRetryCount: 0,
    nextRetryAt: null,
    searchStartedAt: null,
    price: '4.50',
    suggestedPrice: '8.88',
    customerOffer: null as string | null,
    pricingVersion: 7,
    distanceMeters: 12_345,
    currency: 'USD',
    payer: 'SENDER',
    paymentMethod: 'CASH',
    parcelDescription: 'Documents',
    parcelSize: 'SMALL',
    parcelInstructions: null,
    serviceClass: null as string | null,
    deliverBy: null as Date | null,
    pickupAddress: 'Pickup',
    pickupLatitude: '0.0000000',
    pickupLongitude: '0.0000000',
    pickupLandmark: null,
    pickupInstructions: null,
    pickupContactName: 'Ada',
    pickupContactPhone: '+263771111111',
    dropoffAddress: 'Dropoff',
    dropoffLatitude: '0.0200000',
    dropoffLongitude: '0.0200000',
    dropoffLandmark: null,
    dropoffInstructions: null,
    recipientName: 'Bo',
    recipientPhone: '+263772222222',
  };
  ctx.deliveries.push(row);
  return row;
}

function addRider(
  ctx: ReturnType<typeof context>,
  name: string,
  longitude: string,
  updatedAt: Date,
  extra: { approvalStatus?: string } = {},
) {
  const id = `profile-${name}`;
  const profile = {
    id,
    userId: `user-${name}`,
    approvalStatus: extra.approvalStatus ?? 'APPROVED',
    verificationStatus: 'VERIFIED',
    availability: 'AVAILABLE',
  };
  const user = {
    id: profile.userId,
    accountStatus: 'ACTIVE',
    phoneVerifiedAt: NOW,
  };
  const motorcycle = {
    id: `bike-${name}`,
    riderProfileId: id,
    verificationStatus: 'VERIFIED',
    isActive: true,
  };
  const wallet = {
    id: `wallet-${name}`,
    riderProfileId: id,
    balance: '0.00',
    borrowingLimitOverride: null,
    welcomeBonusAwardedAt: NOW,
    currency: 'USD',
  };
  const location = {
    riderProfileId: id,
    latitude: '0.0000000',
    longitude,
    updatedAt,
  };
  ctx.profiles.push(profile);
  ctx.users.push(user);
  ctx.motorcycles.push(motorcycle);
  ctx.wallets.push(wallet);
  ctx.locations.push(location);
  if (ctx.configs.length === 0) {
    ctx.configs.push({
      id: 'config-1',
      configVersion: 3,
      isActive: true,
      platformFee: '0.30',
      defaultBorrowingLimit: '1.00',
      currency: 'USD',
      welcomeBonus: '1.00',
    });
  }
  return { id, profile, wallet, location, latitude: location.latitude, updatedAt };
}

function rider(riderProfileId: string) {
  return { userId: `user-${riderProfileId.replace('profile-', '')}`, riderProfileId };
}

function seedAccepted(ctx: ReturnType<typeof context>, delivery: Row, riderProfileId: string, assignmentId = `assignment-${delivery.id}`) {
  const config = ctx.configs.find((row) => row.isActive) ?? ctx.configs[0];
  const fee = String(config?.platformFee ?? '0.30');
  const configVersion = Number(config?.configVersion ?? 3);
  delivery.status = 'ASSIGNED';
  delivery.searchGeneration = 1;
  ctx.assignments.push({
    id: assignmentId,
    deliveryId: delivery.id,
    riderProfileId,
    status: 'ACCEPTED',
    offerExpiresAt: null,
    searchGeneration: 1,
    acceptedPlatformFee: fee,
    acceptedFeeConfigVersion: configVersion,
    acceptedCommissionModel: 'ON_COMPLETION',
    acceptedCommissionPolicyVersion: 1,
    acceptedBidAmount: null,
    releaseReason: null,
    releasedAt: null,
  });
  if (cents(fee) > 0) {
    const wallet = ctx.wallets.find((row) => row.riderProfileId === riderProfileId);
    ctx.reservations.push({
      id: `reservation-${assignmentId}`,
      riderWalletId: wallet?.id,
      assignmentId,
      deliveryId: delivery.id,
      status: 'OPEN',
      amount: fee,
      promotionalAmount: '0.00',
      walletAmount: fee,
      currency: 'USD',
      configVersion,
      createdAt: NOW,
      releasedAt: null,
      capturedAt: null,
    });
  }
  const profile = ctx.profiles.find((row) => row.id === riderProfileId);
  if (profile) {
    profile.availability = 'BUSY';
  }
  ctx.events.push({
    deliveryId: delivery.id,
    previousStatus: 'CREATED',
    newStatus: 'ASSIGNED',
    actorId: `user-${String(riderProfileId).replace('profile-', '')}`,
    actorType: 'RIDER',
    occurredAt: NOW,
  });
  return assignmentId;
}

function fresh(now: Date): Date {
  return new Date(now.getTime() - GPS_FRESH_MS + 1);
}

function longitudeFor(metres: number): string {
  const estimate = metres / 111_320;
  for (let step = -5_000; step <= 5_000; step += 1) {
    const text = (estimate + step / 10_000_000).toFixed(7);
    if (straightLineMetres(0, 0, 0, Number(text)) === metres) {
      return text;
    }
  }
  throw new Error(`no coordinate for ${metres} metres`);
}

type State = {
  deliveries: Row[];
  assignments: Row[];
  notifications: Row[];
  rounds: Row[];
  locations: Row[];
  profiles: Row[];
  users: Row[];
  motorcycles: Row[];
  wallets: Row[];
  entries: Row[];
  reservations: Row[];
  configs: Row[];
  events: Row[];
  bids: Row[];
};

const STATE_KEYS = [
  'deliveries',
  'assignments',
  'notifications',
  'rounds',
  'locations',
  'profiles',
  'users',
  'motorcycles',
  'wallets',
  'entries',
  'reservations',
  'configs',
  'events',
  'bids',
] as const;

function emptyState(): State {
  return {
    deliveries: [],
    assignments: [],
    notifications: [],
    rounds: [],
    locations: [],
    profiles: [],
    users: [],
    motorcycles: [],
    wallets: [],
    entries: [],
    reservations: [],
    configs: [],
    events: [],
    bids: [],
  };
}

function bidTable(read: () => Row[], mark: () => void) {
  const rows = table(read, mark, () => 0);
  return {
    ...rows,
    async updateMany({ where, data }: { where: Row; data: Row }) {
      const matched = read().filter((row) => matches(row, where));
      for (const row of matched) {
        Object.assign(row, data);
      }
      if (matched.length > 0) {
        mark();
      }
      return { count: matched.length };
    },
  };
}

function table(read: () => Row[], mark: () => void, nextId: () => number) {
  return {
    async findUnique({ where }: { where: Row }) {
      return clone(read().find((row) => matches(row, where)));
    },
    async findFirst({ where }: { where: Row }) {
      return clone(read().find((row) => matches(row, where)));
    },
    async findMany(args?: { where?: Row }) {
      return read().filter((row) => matches(row, args?.where)).map((row) => structuredClone(row));
    },
    async create({ data }: { data: Row }) {
      const row = { id: data.id ?? `id-${nextId()}`, ...data };
      read().push(row);
      mark();
      return structuredClone(row);
    },
    async update({ where, data }: { where: Row; data: Row }) {
      const row = read().find((item) => matches(item, where));
      if (!row) {
        throw new Error('missing row');
      }
      for (const [key, value] of Object.entries(data)) {
        if (
          value !== null &&
          typeof value === 'object' &&
          'increment' in value &&
          typeof value.increment === 'number'
        ) {
          row[key] = Number(row[key] ?? 0) + value.increment;
        } else {
          row[key] = value;
        }
      }
      mark();
      return structuredClone(row);
    },
  };
}

function assignmentTable(read: () => Row[], mark: () => void, nextId: () => number) {
  const rows = table(read, mark, nextId);
  return {
    ...rows,
    async create({ data }: { data: Row }) {
      assertAssignment(read(), { id: data.id ?? `id-${nextId()}`, ...data }, null);
      return rows.create({ data });
    },
    async update({ where, data }: { where: Row; data: Row }) {
      const current = read().find((row) => matches(row, where));
      if (!current) {
        throw new Error('missing assignment');
      }
      assertAssignment(read(), { ...current, ...data }, current);
      return rows.update({ where, data });
    },
  };
}

function reservationTable(read: () => Row[], mark: () => void, nextId: () => number) {
  const rows = table(read, mark, nextId);
  return {
    ...rows,
    async create({ data }: { data: Row }) {
      if (data.status === 'OPEN' && read().some((row) => row.deliveryId === data.deliveryId && row.status === 'OPEN')) {
        throw uniqueError();
      }
      return rows.create({ data });
    },
  };
}

function assertAssignment(rows: Row[], next: Row, current: Row | null): void {
  const others = rows.filter((row) => row !== current);
  if (next.idempotencyKey && others.some((row) => row.idempotencyKey === next.idempotencyKey)) {
    throw uniqueError();
  }
  if (next.status === 'OFFERED' || next.status === 'ACCEPTED') {
    if (others.some((row) => row.deliveryId === next.deliveryId && row.riderProfileId === next.riderProfileId && (row.status === 'OFFERED' || row.status === 'ACCEPTED'))) {
      throw uniqueError();
    }
  }
  if (next.status === 'ACCEPTED') {
    if (others.some((row) => row.status === 'ACCEPTED' && (row.deliveryId === next.deliveryId || row.riderProfileId === next.riderProfileId))) {
      throw uniqueError();
    }
  }
}

function uniqueError(): Error {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.1.0',
  });
}

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) {
    return true;
  }
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

function clone(row: Row | undefined): Row | null {
  return row ? structuredClone(row) : null;
}

function stable(row: Row): string {
  return JSON.stringify(row);
}

function cents(value: unknown): number {
  const text = String(value ?? '0.00');
  const negative = text.startsWith('-');
  const [whole, fraction] = (negative ? text.slice(1) : text).split('.');
  const amount = Number(whole) * 100 + Number(fraction ?? '0');
  return negative ? -amount : amount;
}

type Mutex = { owner: number | null; depth: number; waiters: Array<() => void> };

async function hold(mutexes: Map<string, Mutex>, key: string, txId: number, releases: Array<() => void>): Promise<void> {
  let mutex = mutexes.get(key);
  if (!mutex) {
    mutex = { owner: null, depth: 0, waiters: [] };
    mutexes.set(key, mutex);
  }
  if (mutex.owner === txId) {
    mutex.depth += 1;
  } else if (mutex.owner === null) {
    mutex.owner = txId;
    mutex.depth = 1;
  } else {
    await new Promise<void>((resolve) => {
      mutex.waiters.push(() => {
        mutex.owner = txId;
        mutex.depth = 1;
        resolve();
      });
    });
  }
  releases.push(() => {
    if (mutex.owner !== txId) {
      return;
    }
    mutex.depth -= 1;
    if (mutex.depth > 0) {
      return;
    }
    mutex.owner = null;
    const next = mutex.waiters.shift();
    if (next) {
      next();
    }
  });
}










