import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
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
    expect(ctx.writes).toEqual([RiderAvailability.AVAILABLE]);
    expect(ctx.assignments).toEqual([]);
    expect(ctx.locks).toEqual(['profile', 'motorcycles']);

    await expect(ctx.service.offline(RIDER, NOW)).resolves.toEqual({ availability: RiderAvailability.OFFLINE });
    expect(ctx.profile.availability).toBe(RiderAvailability.OFFLINE);
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
    const json = JSON.stringify(response);
    expect(json).not.toContain(ctx.user.phone);
    expect(json).not.toContain('reviewerId');
    expect(json).not.toContain('objectKey');
  });

  it('does not take an available rider offline during an accepted delivery', async () => {
    const ctx = context();
    ctx.profile.availability = RiderAvailability.AVAILABLE;
    ctx.user.phoneVerifiedAt = null;
    ctx.assignments.push({ id: 'delivery-1', riderProfileId: 'profile-1', status: AssignmentStatus.ACCEPTED });

    await expect(ctx.service.online(RIDER, NOW)).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.profile.availability).toBe(RiderAvailability.AVAILABLE);
    expect(ctx.writes).toEqual([]);

    ctx.user.phoneVerifiedAt = NOW;
    await expect(ctx.service.offline(RIDER, NOW)).rejects.toThrow('You cannot go offline during a delivery');
    expect(ctx.profile.availability).toBe(RiderAvailability.AVAILABLE);
  });

  it('allows offline while an offer is outstanding', async () => {
    const ctx = context();
    ctx.profile.availability = RiderAvailability.AVAILABLE;
    ctx.assignments.push({ id: 'offer-1', riderProfileId: 'profile-1', status: AssignmentStatus.OFFERED });

    await expect(ctx.service.offline(RIDER, NOW)).resolves.toEqual({ availability: RiderAvailability.OFFLINE });
    expect(ctx.assignments[0].status).toBe(AssignmentStatus.OFFERED);
  });

  it('refuses both actions while busy', async () => {
    const ctx = context();
    ctx.profile.availability = RiderAvailability.BUSY;
    ctx.user.accountStatus = AccountStatus.SUSPENDED;

    await expect(ctx.service.online(RIDER, NOW)).rejects.toThrow('Availability cannot be changed while busy');
    await expect(ctx.service.offline(RIDER, NOW)).rejects.toThrow('Availability cannot be changed while busy');
    expect(ctx.profile.availability).toBe(RiderAvailability.BUSY);
    expect(ctx.writes).toEqual([]);
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
});

type ProfileRow = {
  id: string;
  userId: string;
  verificationStatus: RiderVerificationStatus;
  approvalStatus: RiderApprovalStatus;
  availability: RiderAvailability;
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
};

function context() {
  const profiles: ProfileRow[] = [{
    id: 'profile-1',
    userId: 'user-1',
    verificationStatus: RiderVerificationStatus.VERIFIED,
    approvalStatus: RiderApprovalStatus.APPROVED,
    availability: RiderAvailability.OFFLINE,
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
  let releasePause = () => undefined;
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
    let release = () => undefined;
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
      async findFirst({ where }: { where: { riderProfileId: string; status: AssignmentStatus } }) {
        return assignments.find((row) => row.riderProfileId === where.riderProfileId && row.status === where.status) ?? null;
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
    async $transaction<T>(callback: (tx: typeof db) => Promise<T>) {
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
