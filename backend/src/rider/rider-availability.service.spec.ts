import { readFileSync } from 'node:fs';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AccountStatus,
  AssignmentStatus,
  MotorcycleVerificationStatus,
  RiderApprovalStatus,
  RiderAvailability,
  RiderVerificationStatus,
} from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { RiderContext } from '../auth/rider-access.service.js';
import { MotorcycleService } from './motorcycle.service.js';
import {
  AVAILABILITY_NO_LONGER_ELIGIBLE_MESSAGE,
  AVAILABILITY_NO_LONGER_ELIGIBLE_REASON,
  RiderAvailabilityService,
} from './rider-availability.service.js';

const NOW = new Date('2026-10-13T12:00:00.000Z');
const RIDER: RiderContext = { userId: 'user-1', riderProfileId: 'profile-1' };

describe('rider availability', () => {
  beforeEach(() => {
    delete process.env.V2_MARKETPLACE_ENABLED;
  });

  afterEach(() => {
    delete process.env.V2_MARKETPLACE_ENABLED;
  });

  it('goes online only when every operational requirement passes', async () => {
    const inactive = context();
    inactive.user.accountStatus = AccountStatus.SUSPENDED;
    await expect(inactive.service.online(RIDER, NOW)).rejects.toThrow('An active verified account is required');
    expect(inactive.profile.availability).toBe(RiderAvailability.OFFLINE);
    expect(inactive.writes).toEqual([]);

    const unverifiedPhone = context();
    unverifiedPhone.user.phoneVerifiedAt = null;
    await expect(unverifiedPhone.service.online(RIDER, NOW)).rejects.toThrow('An active verified account is required');
    expect(unverifiedPhone.profile.availability).toBe(RiderAvailability.OFFLINE);

    const unapproved = context();
    unapproved.profile.approvalStatus = RiderApprovalStatus.PENDING;
    await expect(unapproved.service.online(RIDER, NOW)).rejects.toThrow('Rider approval is required');
    expect(unapproved.profile.availability).toBe(RiderAvailability.OFFLINE);

    const unverifiedLicence = context();
    unverifiedLicence.profile.verificationStatus = RiderVerificationStatus.PENDING;
    await expect(unverifiedLicence.service.online(RIDER, NOW)).rejects.toThrow('A verified licence is required');
    expect(unverifiedLicence.profile.availability).toBe(RiderAvailability.OFFLINE);

    const noActiveMotorcycle = context();
    noActiveMotorcycle.motorcycles[0].isActive = false;
    await expect(noActiveMotorcycle.service.online(RIDER, NOW)).rejects.toThrow('An active verified motorcycle is required');
    expect(noActiveMotorcycle.profile.availability).toBe(RiderAvailability.OFFLINE);
    expect(noActiveMotorcycle.assignments).toEqual([]);
  });

  it('goes online and offline without creating an assignment or becoming busy', async () => {
    const ctx = context();
    await expect(ctx.service.online(RIDER, NOW)).resolves.toEqual({ availability: RiderAvailability.AVAILABLE });
    expect(ctx.profile.availability).toBe(RiderAvailability.AVAILABLE);
    expect(ctx.profile.receivingRequests).toBeNull();
    expect(ctx.writes).toEqual([RiderAvailability.AVAILABLE]);
    expect(ctx.assignments).toEqual([]);
    expect(ctx.locks).toEqual(['profile', 'motorcycles']);

    await expect(ctx.service.offline(RIDER, NOW)).resolves.toEqual({ availability: RiderAvailability.OFFLINE });
    expect(ctx.profile.availability).toBe(RiderAvailability.OFFLINE);
    expect(ctx.profile.receivingRequests).toBeNull();
    expect(ctx.writes).toEqual([RiderAvailability.AVAILABLE, RiderAvailability.OFFLINE]);
  });

  it('keeps a repeated online or offline request from writing again', async () => {
    const ctx = context();
    await ctx.service.online(RIDER, NOW);
    ctx.writes.length = 0;

    await expect(ctx.service.online(RIDER, NOW)).resolves.toEqual({ availability: RiderAvailability.AVAILABLE });
    expect(ctx.writes).toEqual([]);

    await ctx.service.offline(RIDER, NOW);
    ctx.writes.length = 0;
    ctx.assignments.push({ id: 'offer-1', riderProfileId: 'profile-1', status: AssignmentStatus.ACCEPTED });
    await expect(ctx.service.offline(RIDER, NOW)).resolves.toEqual({ availability: RiderAvailability.OFFLINE });
    expect(ctx.writes).toEqual([]);
    expect(ctx.profile.availability).toBe(RiderAvailability.OFFLINE);
  });

  it('commits offline when an available rider loses eligibility and has no accepted delivery', async () => {
    const ctx = context();
    ctx.profile.availability = RiderAvailability.AVAILABLE;
    ctx.profile.receivingRequests = true;
    ctx.user.accountStatus = AccountStatus.DEACTIVATED;

    const response = await ctx.service.online(RIDER, NOW);
    expect(response).toEqual({
      availability: RiderAvailability.OFFLINE,
      eligible: false,
      reason: AVAILABILITY_NO_LONGER_ELIGIBLE_REASON,
      message: AVAILABILITY_NO_LONGER_ELIGIBLE_MESSAGE,
    });
    expect(ctx.profile.availability).toBe(RiderAvailability.OFFLINE);
    expect(ctx.writes).toEqual([RiderAvailability.OFFLINE]);
    expect(ctx.profile.receivingRequests).toBe(true);
    const json = JSON.stringify(response);
    expect(json).not.toContain(ctx.user.phone);
    expect(json).not.toContain('reviewerId');
    expect(json).not.toContain('objectKey');
  });

  it('stops new offers when eligibility is lost during an accepted delivery and keeps the assignment', async () => {
    const ctx = context();
    ctx.profile.availability = RiderAvailability.AVAILABLE;
    ctx.user.phoneVerifiedAt = null;
    ctx.assignments.push({ id: 'delivery-1', riderProfileId: 'profile-1', status: AssignmentStatus.ACCEPTED });

    await expect(ctx.service.online(RIDER, NOW)).resolves.toMatchObject({
      availability: RiderAvailability.OFFLINE,
      eligible: false,
    });
    expect(ctx.profile.availability).toBe(RiderAvailability.OFFLINE);
    expect(ctx.profile.receivingRequests).toBeNull();
    expect(ctx.assignments[0]?.status).toBe(AssignmentStatus.ACCEPTED);
  });

  it('allows offline while an offer is outstanding', async () => {
    const ctx = context();
    ctx.profile.availability = RiderAvailability.AVAILABLE;
    ctx.assignments.push({ id: 'offer-1', riderProfileId: 'profile-1', status: AssignmentStatus.OFFERED });

    await expect(ctx.service.offline(RIDER, NOW)).resolves.toEqual({ availability: RiderAvailability.OFFLINE });
    expect(ctx.assignments[0].status).toBe(AssignmentStatus.OFFERED);
  });

  it('refuses going online while busy and still allows offline', async () => {
    const ctx = context();
    ctx.profile.availability = RiderAvailability.BUSY;
    ctx.user.accountStatus = AccountStatus.SUSPENDED;
    ctx.assignments.push({ id: 'delivery-1', riderProfileId: 'profile-1', status: AssignmentStatus.ACCEPTED });

    await expect(ctx.service.online(RIDER, NOW)).rejects.toThrow('Availability cannot be changed while busy');
    await expect(ctx.service.offline(RIDER, NOW)).resolves.toEqual({ availability: RiderAvailability.OFFLINE });
    expect(ctx.profile.availability).toBe(RiderAvailability.OFFLINE);
    expect(ctx.assignments[0]?.status).toBe(AssignmentStatus.ACCEPTED);
    expect(ctx.writes).toEqual([RiderAvailability.OFFLINE]);
  });

  it('does not let motorcycle selection clear the active motorcycle while going online', async () => {
    const ctx = context();
    ctx.motorcycles.push(motorcycle('bike-2', false));
    ctx.pauseFirstLock = true;
    const goingOnline = ctx.service.online(RIDER, NOW);
    await waitUntil(() => ctx.held);

    const selecting = ctx.motorcyclesService.selectActive(RIDER, 'bike-2', NOW);
    await waitUntil(() => ctx.waiting > 0);
    expect(ctx.motorcycles.find((row) => row.id === 'bike-1')?.isActive).toBe(true);

    ctx.releasePause();
    await expect(goingOnline).resolves.toEqual({ availability: RiderAvailability.AVAILABLE });
    await expect(selecting).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.motorcycles.find((row) => row.id === 'bike-1')?.isActive).toBe(true);
    expect(ctx.motorcycles.find((row) => row.id === 'bike-2')?.isActive).toBe(false);
    expect(ctx.profile.availability).toBe(RiderAvailability.AVAILABLE);
  });

  it('turns receiving on with online and off with offline', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = context();

    await expect(ctx.service.online(RIDER, NOW)).resolves.toEqual({
      availability: RiderAvailability.AVAILABLE,
      receiving: true,
    });
    expect(ctx.profile.receivingRequests).toBe(true);
    expect(ctx.assignments).toEqual([]);

    await expect(ctx.service.offline(RIDER, NOW)).resolves.toEqual({
      availability: RiderAvailability.OFFLINE,
      receiving: false,
    });
    expect(ctx.profile.availability).toBe(RiderAvailability.OFFLINE);
    expect(ctx.profile.receivingRequests).toBe(false);
    expect(ctx.writes).toEqual([RiderAvailability.AVAILABLE, RiderAvailability.OFFLINE]);

    await expect(ctx.service.offline(RIDER, NOW)).resolves.toEqual({
      availability: RiderAvailability.OFFLINE,
      receiving: false,
    });
    expect(ctx.writes).toEqual([RiderAvailability.AVAILABLE, RiderAvailability.OFFLINE]);
  });

  it('starts receiving for an available rider who was paused, without a separate preference', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = context();
    ctx.profile.availability = RiderAvailability.AVAILABLE;
    ctx.profile.receivingRequests = false;
    ctx.assignments.push({
      id: 'flexible-1',
      riderProfileId: 'profile-1',
      status: AssignmentStatus.ACCEPTED,
      acceptedBidAmount: '8.00',
    });

    await expect(ctx.service.online(RIDER, NOW)).resolves.toEqual({
      availability: RiderAvailability.AVAILABLE,
      receiving: true,
    });
    expect(ctx.profile.receivingRequests).toBe(true);
    expect(ctx.assignments[0]?.status).toBe(AssignmentStatus.ACCEPTED);
    expect(ctx.writes).toEqual([]);

    await expect(ctx.service.setReceiving(RIDER, { receiving: false }, NOW)).resolves.toEqual({
      availability: RiderAvailability.OFFLINE,
      receiving: false,
    });
    expect(ctx.profile.availability).toBe(RiderAvailability.OFFLINE);
    expect(ctx.assignments[0]?.status).toBe(AssignmentStatus.ACCEPTED);

    await expect(ctx.service.setReceiving(RIDER, { receiving: true }, NOW)).resolves.toEqual({
      availability: RiderAvailability.AVAILABLE,
      receiving: true,
    });
    expect(ctx.profile.receivingRequests).toBe(true);
    expect(ctx.assignments[0]?.status).toBe(AssignmentStatus.ACCEPTED);
    await expect(ctx.service.setReceiving(RIDER, { receiving: 'yes' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps eligibility checks when going online and does not pause a busy rider in place', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const busy = context();
    busy.profile.availability = RiderAvailability.BUSY;
    busy.profile.receivingRequests = true;
    busy.assignments.push({
      id: 'delivery-1',
      riderProfileId: 'profile-1',
      status: AssignmentStatus.ACCEPTED,
    });
    await expect(busy.service.online(RIDER, NOW)).rejects.toThrow('Availability cannot be changed while busy');
    expect(busy.profile.availability).toBe(RiderAvailability.BUSY);
    expect(busy.profile.receivingRequests).toBe(true);
    expect(busy.assignments[0]?.status).toBe(AssignmentStatus.ACCEPTED);

    const marketplace = context();
    marketplace.profile.availability = RiderAvailability.BUSY;
    marketplace.profile.receivingRequests = false;
    marketplace.assignments.push(
      { id: 'flexible-1', riderProfileId: 'profile-1', status: AssignmentStatus.ACCEPTED, acceptedBidAmount: '8.00' },
      { id: 'express-1', riderProfileId: 'profile-1', status: AssignmentStatus.ACCEPTED, acceptedBidAmount: '6.00' },
    );
    await expect(marketplace.service.online(RIDER, NOW)).resolves.toEqual({
      availability: RiderAvailability.AVAILABLE,
      receiving: true,
    });
    expect(marketplace.assignments.map((row) => row.status)).toEqual([AssignmentStatus.ACCEPTED, AssignmentStatus.ACCEPTED]);
    await expect(marketplace.service.offline(RIDER, NOW)).resolves.toEqual({
      availability: RiderAvailability.OFFLINE,
      receiving: false,
    });
    expect(marketplace.assignments).toHaveLength(2);

    const stale = context();
    stale.profile.availability = RiderAvailability.BUSY;
    stale.profile.receivingRequests = true;
    await expect(stale.service.online(RIDER, NOW)).resolves.toEqual({
      availability: RiderAvailability.AVAILABLE,
      receiving: true,
    });
    expect(stale.assignments).toEqual([]);

    const ineligible = context();
    ineligible.user.phoneVerifiedAt = null;
    await expect(ineligible.service.online(RIDER, NOW)).rejects.toThrow('An active verified account is required');
    expect(ineligible.profile.availability).toBe(RiderAvailability.OFFLINE);
    expect(ineligible.profile.receivingRequests).toBeNull();
  });

  it('goes offline with a V2 assignment and leaves that assignment accepted', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = context();
    ctx.profile.availability = RiderAvailability.AVAILABLE;
    ctx.profile.receivingRequests = true;
    ctx.assignments.push({
      id: 'assignment-1',
      riderProfileId: 'profile-1',
      status: AssignmentStatus.ACCEPTED,
      acceptedBidAmount: '4.50',
    });

    await expect(ctx.service.offline(RIDER, NOW)).resolves.toEqual({
      availability: RiderAvailability.OFFLINE,
      receiving: false,
    });
    expect(ctx.assignments[0]).toMatchObject({ status: AssignmentStatus.ACCEPTED, acceptedBidAmount: '4.50' });
    expect(ctx.profile.receivingRequests).toBe(false);
  });

  it('goes offline with a V1 accepted assignment and leaves it accepted', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = context();
    ctx.profile.availability = RiderAvailability.AVAILABLE;
    ctx.profile.receivingRequests = true;
    ctx.assignments.push({ id: 'offer-1', riderProfileId: 'profile-1', status: AssignmentStatus.ACCEPTED, acceptedBidAmount: null });

    await expect(ctx.service.offline(RIDER, NOW)).resolves.toEqual({
      availability: RiderAvailability.OFFLINE,
      receiving: false,
    });
    expect(ctx.profile.receivingRequests).toBe(false);
    expect(ctx.assignments[0]?.status).toBe(AssignmentStatus.ACCEPTED);
  });

  it('goes offline with an accepted assignment while the marketplace flag is off', async () => {
    const ctx = context();
    ctx.profile.availability = RiderAvailability.AVAILABLE;
    ctx.assignments.push({
      id: 'assignment-1',
      riderProfileId: 'profile-1',
      status: AssignmentStatus.ACCEPTED,
      acceptedBidAmount: '4.50',
    });

    await expect(ctx.service.offline(RIDER, NOW)).resolves.toEqual({ availability: RiderAvailability.OFFLINE });
    expect(ctx.profile.receivingRequests).toBeNull();
    expect(ctx.assignments[0]?.status).toBe(AssignmentStatus.ACCEPTED);
  });

  it('keeps active Express and Flexible deliveries while online and offline change only receiving', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const available = context();
    available.profile.availability = RiderAvailability.AVAILABLE;
    available.profile.receivingRequests = true;
    available.assignments.push(
      { id: 'flexible-1', riderProfileId: 'profile-1', status: AssignmentStatus.ACCEPTED, acceptedBidAmount: '8.00' },
      { id: 'express-1', riderProfileId: 'profile-1', status: AssignmentStatus.ACCEPTED, acceptedBidAmount: '6.00' },
    );

    await expect(available.service.offline(RIDER, NOW)).resolves.toEqual({
      availability: RiderAvailability.OFFLINE,
      receiving: false,
    });
    await expect(available.service.online(RIDER, NOW)).resolves.toEqual({
      availability: RiderAvailability.AVAILABLE,
      receiving: true,
    });
    expect(available.assignments.map((row) => row.status)).toEqual([AssignmentStatus.ACCEPTED, AssignmentStatus.ACCEPTED]);
    expect(available.profile.receivingRequests).toBe(true);

    const paused = context();
    paused.profile.availability = RiderAvailability.OFFLINE;
    paused.profile.receivingRequests = true;
    paused.assignments.push({
      id: 'express-2',
      riderProfileId: 'profile-1',
      status: AssignmentStatus.ACCEPTED,
      acceptedBidAmount: '6.00',
    });
    await expect(paused.service.offline(RIDER, NOW)).resolves.toEqual({
      availability: RiderAvailability.OFFLINE,
      receiving: false,
    });
    expect(paused.profile.receivingRequests).toBe(false);
    expect(paused.assignments[0]?.status).toBe(AssignmentStatus.ACCEPTED);
  });

  it('disables receiving when an online rider loses eligibility and keeps the V2 assignment', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = context();
    ctx.profile.availability = RiderAvailability.AVAILABLE;
    ctx.profile.receivingRequests = true;
    ctx.user.accountStatus = AccountStatus.DEACTIVATED;
    ctx.assignments.push({
      id: 'assignment-1',
      riderProfileId: 'profile-1',
      status: AssignmentStatus.ACCEPTED,
      acceptedBidAmount: '4.50',
    });

    await expect(ctx.service.online(RIDER, NOW)).resolves.toMatchObject({
      availability: RiderAvailability.OFFLINE,
      receiving: false,
      eligible: false,
    });
    expect(ctx.assignments[0].status).toBe(AssignmentStatus.ACCEPTED);
    expect(ctx.profile.receivingRequests).toBe(false);
  });

  it('hides the receiving endpoint and leaves the column unchanged when the marketplace flag is off', async () => {
    const ctx = context();
    ctx.profile.availability = RiderAvailability.AVAILABLE;
    ctx.profile.receivingRequests = true;

    await expect(ctx.service.setReceiving(RIDER, { receiving: false }, NOW)).rejects.toBeInstanceOf(NotFoundException);
    expect(ctx.profile.availability).toBe(RiderAvailability.AVAILABLE);
    expect(ctx.profile.receivingRequests).toBe(true);
  });

  it('does not change rider availability when a marketplace delivery is accepted, progressed, or cancelled', () => {
    const acceptance = readFileSync(new URL('../delivery/bid-acceptance.service.ts', import.meta.url), 'utf8');
    expect(acceptance).not.toContain('riderProfile.update');
    expect(acceptance).not.toContain('receivingRequests:');
    const dispatch = readFileSync(new URL('../delivery/dispatch.service.ts', import.meta.url), 'utf8');
    expect(dispatch).not.toContain('riderProfile.update');
    const bids = readFileSync(new URL('../delivery/bid.service.ts', import.meta.url), 'utf8');
    expect(bids).not.toContain('riderProfile.update');
    expect(bids).not.toContain('receivingRequests:');
    const progress = dispatch.slice(dispatch.indexOf('async function progressDelivery'), dispatch.indexOf('function progressReplay'));
    expect(progress).toContain('const availability = profile.availability');
    expect(progress).not.toContain('OFFLINE');
    expect(progress).not.toContain('receivingRequests');
    const riderCancel = dispatch.slice(dispatch.indexOf('async function cancelBeforePickup'), dispatch.indexOf('async function cancellationReplay'));
    expect(riderCancel).not.toContain('restoreAvailability');
    expect(riderCancel).not.toContain('riderProfile.update');
    const customerCancel = dispatch.slice(dispatch.indexOf('async function cancelV2DeliveryByCustomer'), dispatch.indexOf('async function cancelDelivery'));
    expect(customerCancel).not.toContain('restoreAvailability');
    expect(customerCancel).not.toContain('riderProfile.update');
  });
});

type ProfileRow = {
  id: string;
  userId: string;
  verificationStatus: RiderVerificationStatus;
  approvalStatus: RiderApprovalStatus;
  availability: RiderAvailability;
  receivingRequests: boolean | null;
  updatedAt: Date;
};

type UserRow = {
  id: string;
  accountStatus: AccountStatus;
  phoneVerifiedAt: Date | null;
  phone: string;
};

type MotorcycleRow = {
  id: string;
  riderProfileId: string;
  registrationNumber: string;
  make: string;
  model: string;
  colour: string;
  verificationStatus: MotorcycleVerificationStatus;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type AssignmentRow = {
  id: string;
  riderProfileId: string;
  status: AssignmentStatus;
  acceptedBidAmount?: string | null;
};

function context() {
  const profiles: ProfileRow[] = [{
    id: 'profile-1',
    userId: 'user-1',
    verificationStatus: RiderVerificationStatus.VERIFIED,
    approvalStatus: RiderApprovalStatus.APPROVED,
    availability: RiderAvailability.OFFLINE,
    receivingRequests: null,
    updatedAt: NOW,
  }];
  const users: UserRow[] = [{
    id: 'user-1',
    accountStatus: AccountStatus.ACTIVE,
    phoneVerifiedAt: NOW,
    phone: '+263700000001',
  }];
  const motorcycles: MotorcycleRow[] = [motorcycle('bike-1', true)];
  const assignments: AssignmentRow[] = [];
  const writes: RiderAvailability[] = [];
  const locks: string[] = [];
  const state = { pauseFirstLock: false, paused: false, held: false, waiting: 0 };
  let releasePause: () => void = () => undefined;
  const pause = new Promise<void>((resolve) => {
    releasePause = resolve;
  });
  const holders = new Map<string, Promise<void>>();
  const acquire = async (id: string) => {
    while (holders.has(id)) {
      state.waiting += 1;
      await holders.get(id);
      state.waiting -= 1;
    }
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    holders.set(id, gate);
    state.held = true;
    return () => {
      if (holders.get(id) === gate) holders.delete(id);
      release();
    };
  };
  const db = {
    user: {
      async findUnique({ where }: { where: { id: string } }) {
        return users.find((user) => user.id === where.id) ?? null;
      },
    },
    riderProfile: {
      async findUnique({ where }: { where: { id: string } }) {
        return profiles.find((profile) => profile.id === where.id) ?? null;
      },
      async update({ where, data }: { where: { id: string }; data: Partial<ProfileRow> }) {
        const profile = profiles.find((row) => row.id === where.id);
        if (!profile) throw new Error('profile missing');
        if (data.availability) writes.push(data.availability);
        Object.assign(profile, data);
        return profile;
      },
    },
    motorcycle: {
      async findMany({ where }: { where: { riderProfileId: string } }) {
        return motorcycles.filter((row) => row.riderProfileId === where.riderProfileId);
      },
      async findFirst({ where }: { where: { id: string; riderProfileId: string } }) {
        return motorcycles.find((row) => row.id === where.id && row.riderProfileId === where.riderProfileId) ?? null;
      },
      async updateMany({ where, data }: { where: { riderProfileId: string; isActive: boolean }; data: Partial<MotorcycleRow> }) {
        for (const row of motorcycles) {
          if (row.riderProfileId === where.riderProfileId && row.isActive === where.isActive) Object.assign(row, data);
        }
        return { count: 1 };
      },
      async update({ where, data }: { where: { id: string }; data: Partial<MotorcycleRow> }) {
        const row = motorcycles.find((motorcycle) => motorcycle.id === where.id);
        if (!row) throw new Error('motorcycle missing');
        Object.assign(row, data);
        return row;
      },
    },
    deliveryAssignment: {
      async findFirst({ where }: { where: { riderProfileId: string; status: AssignmentStatus; acceptedBidAmount?: null } }) {
        return assignments.find((row) => {
          if (row.riderProfileId !== where.riderProfileId || row.status !== where.status) return false;
          if ('acceptedBidAmount' in where) return row.acceptedBidAmount == null;
          return true;
        }) ?? null;
      },
    },
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join(' ');
      if (sql.includes('rider_profiles') && sql.includes('FOR UPDATE')) {
        const release = await acquire(String(values[0]));
        locks.push('profile');
        if (state.pauseFirstLock && !state.paused) {
          state.paused = true;
          await pause;
        }
        return release;
      }
      if (sql.includes('motorcycles') && sql.includes('FOR UPDATE')) locks.push('motorcycles');
      return undefined;
    },
    async $transaction<T>(callback: (tx: object) => Promise<T>) {
      const releases: Array<() => void> = [];
      const tx = {
        ...db,
        async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
          const release = await db.$queryRaw(strings, ...values);
          if (typeof release === 'function') releases.push(release);
          return [];
        },
      };
      try {
        return await callback(tx);
      } finally {
        for (const release of releases) release();
      }
    },
  };
  return {
    service: new RiderAvailabilityService(db as unknown as PrismaService),
    motorcyclesService: new MotorcycleService(db as unknown as PrismaService),
    motorcycles,
    assignments,
    writes,
    locks,
    user: users[0],
    get profile() {
      return profiles[0];
    },
    get pauseFirstLock() {
      return state.pauseFirstLock;
    },
    set pauseFirstLock(value: boolean) {
      state.pauseFirstLock = value;
    },
    get held() {
      return state.held;
    },
    get waiting() {
      return state.waiting;
    },
    releasePause: () => releasePause(),
  };
}

function motorcycle(id: string, isActive: boolean): MotorcycleRow {
  return {
    id,
    riderProfileId: 'profile-1',
    registrationNumber: id.toUpperCase(),
    make: 'Honda',
    model: 'XL',
    colour: 'Red',
    verificationStatus: MotorcycleVerificationStatus.VERIFIED,
    isActive,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 1000) throw new Error('timed out waiting for the rider lock');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
