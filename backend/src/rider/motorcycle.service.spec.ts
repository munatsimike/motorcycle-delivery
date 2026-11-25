import { ConflictException, NotFoundException } from '@nestjs/common';
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
import { assignmentMotorcycleConstraintHolds, motorcycleOwnerConstraintHolds } from './assignment-motorcycle.js';
import { motorcycleForAcceptance } from './motorcycle-eligibility.js';
import { MotorcycleReviewService } from './motorcycle-review.service.js';
import { MotorcycleService } from './motorcycle.service.js';

const NOW = new Date('2026-10-13T12:00:00.000Z');
const LATER = new Date('2026-10-14T12:00:00.000Z');
const RIDER = { userId: 'user-1', riderProfileId: 'profile-1' };
const OTHER = { userId: 'user-2', riderProfileId: 'profile-2' };
const ADMIN = { userId: 'admin-1' };

describe('MotorcycleService', () => {
  it('registers several pending motorcycles and hides another rider\'s rows', async () => {
    const ctx = context();
    const before = snapshot(ctx);
    const first = await ctx.service.register(RIDER, details('ab 1'), NOW);
    const second = await ctx.service.register(RIDER, details('ab 2'), NOW);
    await ctx.service.register(OTHER, details('ab 3'), NOW);

    expect(first.verificationStatus).toBe(MotorcycleVerificationStatus.PENDING);
    expect(first.isActive).toBe(false);
    expect(second.isActive).toBe(false);
    expect(first.registrationNumber).toBe('AB 1');
    await expect(ctx.service.list(RIDER)).resolves.toHaveLength(2);
    await expect(ctx.service.get(RIDER, second.id)).resolves.toMatchObject({ id: second.id });
    await expect(ctx.service.get(RIDER, ctx.motorcycles[2].id)).rejects.toBeInstanceOf(NotFoundException);
    expect(snapshot(ctx)).toEqual(before);
  });

  it('rejects a duplicate registration, including a concurrent insert', async () => {
    const ctx = context();
    await ctx.service.register(RIDER, details('ab 1'), NOW);
    await expect(ctx.service.register(OTHER, details(' AB   1 '), NOW)).rejects.toBeInstanceOf(ConflictException);

    const raced = context();
    const results = await Promise.allSettled([
      raced.service.register(RIDER, details('ab 9'), NOW),
      raced.service.register(OTHER, details('ab 9'), NOW),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(raced.motorcycles).toHaveLength(1);
  });

  it('ignores rider attempts to mark a motorcycle verified', async () => {
    const ctx = context();
    const created = await ctx.service.register(RIDER, {
      ...details('ab 1'),
      verificationStatus: 'VERIFIED',
      isActive: true,
    }, NOW);
    expect(created.verificationStatus).toBe(MotorcycleVerificationStatus.PENDING);
    expect(created.isActive).toBe(false);
  });

  it('makes a verified motorcycle active when the rider has not selected one', async () => {
    const ctx = context();
    const later = await ctx.service.register(RIDER, details('ab 2'), LATER);
    const first = await ctx.service.register(RIDER, details('ab 1'), NOW);
    await ctx.review.review(ADMIN, later.id, 'VERIFY', LATER);
    expect(ctx.motorcycles.find((row) => row.id === later.id)?.isActive).toBe(true);

    await ctx.review.review(ADMIN, first.id, 'VERIFY', NOW);
    expect(ctx.motorcycles.filter((row) => row.isActive).map((row) => row.id)).toEqual([later.id]);
  });

  it('selects only one verified motorcycle and serializes concurrent selections', async () => {
    const ctx = context();
    const before = snapshot(ctx);
    const pending = await ctx.service.register(RIDER, details('ab 1'), NOW);
    const first = await ctx.service.register(RIDER, details('ab 2'), NOW);
    const second = await ctx.service.register(RIDER, details('ab 3'), NOW);
    await expect(ctx.service.selectActive(RIDER, pending.id, NOW)).rejects.toBeInstanceOf(ConflictException);

    await ctx.review.review(ADMIN, first.id, 'VERIFY', NOW);
    await ctx.review.review(ADMIN, second.id, 'VERIFY', NOW);
    await ctx.service.selectActive(RIDER, first.id, NOW);
    await ctx.service.selectActive(RIDER, second.id, NOW);
    expect(ctx.motorcycles.filter((row) => row.isActive).map((row) => row.id)).toEqual([second.id]);
    expect(ctx.lockOrders.at(-1)).toEqual(['rider', 'motorcycles']);
    expect(ctx.lockOrders).toContainEqual(['rider', 'motorcycle']);

    const raced = context();
    const bikeA = await raced.service.register(RIDER, details('aa 1'), NOW);
    const bikeB = await raced.service.register(RIDER, details('aa 2'), NOW);
    await raced.review.review(ADMIN, bikeA.id, 'VERIFY', NOW);
    await raced.review.review(ADMIN, bikeB.id, 'VERIFY', NOW);
    await Promise.all([
      raced.service.selectActive(RIDER, bikeA.id, NOW),
      raced.service.selectActive(RIDER, bikeB.id, NOW),
    ]);
    expect(raced.motorcycles.filter((row) => row.isActive)).toHaveLength(1);
    expect(() => raced.forceActive(raced.motorcycles.find((row) => !row.isActive)!.id)).toThrow();
    expect(snapshot(ctx)).toEqual(before);
  });

  it('switches only while offline and without an accepted assignment', async () => {
    const ctx = context();
    const offer = await verified(ctx, 'ab 1');
    const next = await verified(ctx, 'ab 2');
    ctx.addAssignment({ id: 'offer', riderProfileId: RIDER.riderProfileId, motorcycleId: null, status: AssignmentStatus.OFFERED });
    await ctx.service.selectActive(RIDER, offer.id, NOW);
    expect(ctx.assignments[0]).toMatchObject({ status: AssignmentStatus.OFFERED, motorcycleId: null });

    ctx.profile.availability = RiderAvailability.AVAILABLE;
    await expect(ctx.service.selectActive(RIDER, next.id, NOW)).rejects.toBeInstanceOf(ConflictException);
    ctx.profile.availability = RiderAvailability.BUSY;
    await expect(ctx.service.clearActive(RIDER, offer.id, NOW)).rejects.toBeInstanceOf(ConflictException);
    ctx.profile.availability = RiderAvailability.OFFLINE;
    ctx.addAssignment({
      id: 'accepted',
      riderProfileId: RIDER.riderProfileId,
      motorcycleId: offer.id,
      status: AssignmentStatus.ACCEPTED,
    });
    await expect(ctx.service.selectActive(RIDER, next.id, NOW)).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.motorcycles.find((row) => row.id === offer.id)?.isActive).toBe(true);
    expect(ctx.assignments[0].motorcycleId).toBeNull();
  });

  it('binds acceptance to the motorcycle that is active after a switch', async () => {
    const ctx = context();
    const first = await verified(ctx, 'ab 1');
    const second = await verified(ctx, 'ab 2');
    ctx.profile.approvalStatus = RiderApprovalStatus.APPROVED;
    await ctx.service.selectActive(RIDER, first.id, NOW);
    await ctx.service.selectActive(RIDER, second.id, NOW);
    const motorcycles = ctx.motorcycles.map(acceptanceMotorcycle);
    expect(motorcycleForAcceptance({
      accountStatus: AccountStatus.ACTIVE,
      phoneVerifiedAt: NOW,
      approvalStatus: ctx.profile.approvalStatus,
      licenceVerificationStatus: RiderVerificationStatus.VERIFIED,
      motorcycles,
    })).toBe(second.id);

    await ctx.service.clearActive(RIDER, second.id, NOW);
    expect(() => motorcycleForAcceptance({
      accountStatus: AccountStatus.ACTIVE,
      phoneVerifiedAt: NOW,
      approvalStatus: ctx.profile.approvalStatus,
      licenceVerificationStatus: RiderVerificationStatus.VERIFIED,
      motorcycles: ctx.motorcycles.map(acceptanceMotorcycle),
    })).toThrow(ConflictException);
    expect(ctx.assignments).toHaveLength(0);
  });

  it('removes an owned motorbike in any review state and keeps history', async () => {
    const ctx = context();
    const pending = await ctx.service.register(RIDER, details('ab 1'), NOW);
    const rejected = await ctx.service.register(RIDER, details('ab 2'), NOW);
    const verifiedBike = await verified(ctx, 'ab 3');
    const revoked = await verified(ctx, 'ab 4');
    const historical = await verified(ctx, 'ab 5');
    await ctx.review.review(ADMIN, rejected.id, 'REJECT', NOW);
    await ctx.review.review(ADMIN, revoked.id, 'REVOKE', NOW);
    await ctx.service.selectActive(RIDER, verifiedBike.id, NOW);
    ctx.addAssignment({
      id: 'completed',
      riderProfileId: RIDER.riderProfileId,
      motorcycleId: historical.id,
      status: AssignmentStatus.COMPLETED,
    });
    ctx.addAssignment({
      id: 'accepted',
      riderProfileId: RIDER.riderProfileId,
      motorcycleId: verifiedBike.id,
      status: AssignmentStatus.ACCEPTED,
    });

    await expect(ctx.service.remove(RIDER, verifiedBike.id, NOW)).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.motorcycles.find((row) => row.id === verifiedBike.id)?.isActive).toBe(true);
    expect(ctx.profile.availability).toBe(RiderAvailability.OFFLINE);

    await ctx.service.remove(RIDER, pending.id, NOW);
    await ctx.service.remove(RIDER, rejected.id, NOW);
    await ctx.service.remove(RIDER, revoked.id, NOW);
    await ctx.service.remove(RIDER, historical.id, NOW);

    expect(ctx.motorcycles.some((row) => row.id === pending.id)).toBe(false);
    expect(ctx.motorcycles.some((row) => row.id === rejected.id)).toBe(false);
    expect(ctx.motorcycles.some((row) => row.id === revoked.id)).toBe(false);
    expect(ctx.motorcycles.find((row) => row.id === historical.id)).toMatchObject({
      removedAt: NOW,
      isActive: false,
    });
    expect(ctx.assignments.find((row) => row.id === 'completed')?.motorcycleId).toBe(historical.id);
    await expect(ctx.service.list(RIDER)).resolves.toEqual([
      expect.objectContaining({ id: verifiedBike.id, isActive: true }),
    ]);
    await expect(ctx.service.remove(OTHER, verifiedBike.id, NOW)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reassigns the active motorbike or takes the rider offline', async () => {
    const only = context();
    const sole = await verified(only, 'aa 1');
    await only.service.selectActive(RIDER, sole.id, NOW);
    only.profile.availability = RiderAvailability.AVAILABLE;
    await only.service.remove(RIDER, sole.id, NOW);
    expect(only.motorcycles).toHaveLength(0);
    expect(only.profile.availability).toBe(RiderAvailability.OFFLINE);

    const oneLeft = context();
    const active = await verified(oneLeft, 'bb 1');
    const replacement = await verified(oneLeft, 'bb 2');
    const pending = await oneLeft.service.register(RIDER, details('bb 3'), NOW);
    await oneLeft.service.selectActive(RIDER, active.id, NOW);
    oneLeft.profile.availability = RiderAvailability.AVAILABLE;
    await oneLeft.service.remove(RIDER, active.id, NOW);
    expect(oneLeft.motorcycles.find((row) => row.id === replacement.id)?.isActive).toBe(true);
    expect(oneLeft.motorcycles.find((row) => row.id === pending.id)?.isActive).toBe(false);
    expect(oneLeft.profile.availability).toBe(RiderAvailability.AVAILABLE);

    const choose = context();
    const first = await verified(choose, 'cc 1');
    const second = await verified(choose, 'cc 2');
    const third = await verified(choose, 'cc 3');
    await choose.service.selectActive(RIDER, first.id, NOW);
    choose.profile.availability = RiderAvailability.AVAILABLE;
    await choose.service.remove(RIDER, first.id, NOW);
    expect(choose.motorcycles.filter((row) => row.isActive)).toHaveLength(0);
    expect(choose.motorcycles.map((row) => row.id).sort()).toEqual([second.id, third.id].sort());
    expect(choose.profile.availability).toBe(RiderAvailability.OFFLINE);

    const unapproved = context();
    const current = await verified(unapproved, 'dd 1');
    const waiting = await unapproved.service.register(RIDER, details('dd 2'), NOW);
    const declined = await unapproved.service.register(RIDER, details('dd 3'), NOW);
    await unapproved.review.review(ADMIN, declined.id, 'REJECT', NOW);
    await unapproved.service.selectActive(RIDER, current.id, NOW);
    unapproved.profile.availability = RiderAvailability.AVAILABLE;
    await unapproved.service.remove(RIDER, current.id, NOW);
    expect(unapproved.motorcycles.find((row) => row.id === waiting.id)?.isActive).toBe(false);
    expect(unapproved.motorcycles.find((row) => row.id === declined.id)?.isActive).toBe(false);
    expect(unapproved.profile.availability).toBe(RiderAvailability.OFFLINE);

    const inactive = context();
    const kept = await verified(inactive, 'ee 1');
    const spare = await verified(inactive, 'ee 2');
    await inactive.service.selectActive(RIDER, kept.id, NOW);
    inactive.profile.availability = RiderAvailability.AVAILABLE;
    await inactive.service.remove(RIDER, spare.id, NOW);
    expect(inactive.motorcycles.find((row) => row.id === kept.id)?.isActive).toBe(true);
    expect(inactive.profile.availability).toBe(RiderAvailability.AVAILABLE);

    const stranded = context();
    const unused = await verified(stranded, 'ff 1');
    await stranded.service.clearActive(RIDER, unused.id, NOW);
    const extra = await stranded.service.register(RIDER, details('ff 2'), NOW);
    stranded.profile.availability = RiderAvailability.AVAILABLE;
    await stranded.service.remove(RIDER, extra.id, NOW);
    expect(stranded.motorcycles.find((row) => row.id === unused.id)?.isActive).toBe(false);
    expect(stranded.profile.availability).toBe(RiderAvailability.OFFLINE);
  });

  it('keeps initial rejection distinct from revocation and blocks revocation during a delivery', async () => {
    const ctx = context();
    const before = snapshot(ctx);
    const bike = await ctx.service.register(RIDER, details('ab 1'), NOW);
    await ctx.review.review(ADMIN, bike.id, 'REJECT', NOW);
    const rejected = ctx.motorcycles.find((row) => row.id === bike.id)!;
    expect(rejected.verificationStatus).toBe(MotorcycleVerificationStatus.REJECTED);
    expect(rejected.rejectedById).toBe(ADMIN.userId);
    expect(rejected.verifiedAt).toBeNull();
    expect(rejected.verifiedById).toBeNull();

    await ctx.service.update(RIDER, bike.id, details('ab 1', 'Blue'), NOW);
    expect(ctx.motorcycles.find((row) => row.id === bike.id)?.verificationStatus).toBe(MotorcycleVerificationStatus.PENDING);
    expect(ctx.motorcycles.find((row) => row.id === bike.id)?.rejectedAt).toBeNull();

    await ctx.review.review(ADMIN, bike.id, 'VERIFY', NOW);
    const verifiedAt = ctx.motorcycles.find((row) => row.id === bike.id)?.verifiedAt;
    await ctx.service.selectActive(RIDER, bike.id, NOW);
    ctx.addAssignment({
      id: 'accepted',
      riderProfileId: RIDER.riderProfileId,
      motorcycleId: bike.id,
      status: AssignmentStatus.ACCEPTED,
    });
    await expect(ctx.review.review(ADMIN, bike.id, 'REVOKE', NOW)).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.motorcycles.find((row) => row.id === bike.id)).toMatchObject({
      verificationStatus: MotorcycleVerificationStatus.VERIFIED,
      isActive: true,
      revokedAt: null,
    });

    ctx.assignments.splice(0, ctx.assignments.length);
    await ctx.review.review(ADMIN, bike.id, 'REVOKE', NOW);
    expect(ctx.motorcycles.find((row) => row.id === bike.id)).toMatchObject({
      verificationStatus: MotorcycleVerificationStatus.REVOKED,
      isActive: false,
      verifiedAt,
      verifiedById: ADMIN.userId,
      revokedById: ADMIN.userId,
    });
    await expect(ctx.review.review(ADMIN, bike.id, 'VERIFY', NOW)).rejects.toBeInstanceOf(ConflictException);
    expect(snapshot(ctx)).toEqual(before);
  });

  it('does not make an unapproved rider available', async () => {
    const ctx = context();
    const before = snapshot(ctx);
    const bike = await verified(ctx, 'ab 1');
    await ctx.service.selectActive(RIDER, bike.id, NOW);
    await ctx.service.clearActive(RIDER, bike.id, NOW);
    expect(ctx.profile.approvalStatus).toBe(RiderApprovalStatus.PENDING);
    expect(ctx.profile.availability).toBe(RiderAvailability.OFFLINE);
    expect(snapshot(ctx)).toEqual(before);
    expect(ctx.profileWrites).toBe(0);
  });

  it('enforces assignment status and motorcycle ownership in the transactional fake', () => {
    const ctx = context();
    const bike = ctx.motorcycles;
    expect(bike).toHaveLength(0);
    ctx.motorcycles.push(stored('bike-1', 'profile-1'));
    expect(() => ctx.addAssignment({
      id: 'bad-offer',
      riderProfileId: 'profile-1',
      motorcycleId: 'bike-1',
      status: AssignmentStatus.OFFERED,
    })).toThrow('assignment motorcycle constraint');
    expect(() => ctx.addAssignment({
      id: 'foreign',
      riderProfileId: 'profile-2',
      motorcycleId: 'bike-1',
      status: AssignmentStatus.ACCEPTED,
    })).toThrow('motorcycle owner constraint');
    ctx.addAssignment({
      id: 'owned',
      riderProfileId: 'profile-1',
      motorcycleId: 'bike-1',
      status: AssignmentStatus.ACCEPTED,
    });
    expect(ctx.assignments).toHaveLength(1);
  });
});

function details(registrationNumber: string, colour = 'Red') {
  return { registrationNumber, make: 'Honda', model: 'CB', colour };
}

async function verified(ctx: ReturnType<typeof context>, registrationNumber: string) {
  const created = await ctx.service.register(RIDER, details(registrationNumber), NOW);
  await ctx.review.review(ADMIN, created.id, 'VERIFY', NOW);
  return created;
}

function acceptanceMotorcycle(row: MotorcycleRow) {
  return { id: row.id, verificationStatus: row.verificationStatus, isActive: row.isActive };
}

function snapshot(ctx: ReturnType<typeof context>) {
  return {
    approvalStatus: ctx.profile.approvalStatus,
    availability: ctx.profile.availability,
    verificationStatus: ctx.profile.verificationStatus,
    licenceNumber: ctx.profile.licenceNumber,
    licenceClass: ctx.profile.licenceClass,
    verifiedAt: ctx.profile.verifiedAt,
    reviewerId: ctx.profile.reviewerId,
  };
}

type MotorcycleRow = {
  id: string;
  riderProfileId: string;
  registrationNumber: string;
  make: string;
  model: string;
  colour: string;
  verificationStatus: MotorcycleVerificationStatus;
  isActive: boolean;
  verifiedAt: Date | null;
  verifiedById: string | null;
  rejectedAt: Date | null;
  rejectedById: string | null;
  revokedAt: Date | null;
  revokedById: string | null;
  removedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type AssignmentRow = {
  id: string;
  riderProfileId: string;
  motorcycleId: string | null;
  status: AssignmentStatus;
};

function stored(id: string, riderProfileId: string): MotorcycleRow {
  return {
    id,
    riderProfileId,
    registrationNumber: id,
    make: 'Honda',
    model: 'CB',
    colour: 'Red',
    verificationStatus: MotorcycleVerificationStatus.VERIFIED,
    isActive: false,
    verifiedAt: NOW,
    verifiedById: ADMIN.userId,
    rejectedAt: null,
    rejectedById: null,
    revokedAt: null,
    revokedById: null,
    removedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function context() {
  const profile: {
    id: string;
    approvalStatus: RiderApprovalStatus;
    availability: RiderAvailability;
    verificationStatus: RiderVerificationStatus;
    licenceNumber: string | null;
    licenceClass: string | null;
    verifiedAt: Date | null;
    reviewerId: string | null;
  } = {
    id: RIDER.riderProfileId,
    approvalStatus: RiderApprovalStatus.PENDING,
    availability: RiderAvailability.OFFLINE,
    verificationStatus: RiderVerificationStatus.PENDING,
    licenceNumber: null as string | null,
    licenceClass: null as string | null,
    verifiedAt: null as Date | null,
    reviewerId: null as string | null,
  };
  const profiles = [profile, { ...profile, id: OTHER.riderProfileId }];
  const motorcycles: MotorcycleRow[] = [];
  const assignments: AssignmentRow[] = [];
  const lockOrders: string[][] = [];
  let profileWrites = 0;
  let tail = Promise.resolve();

  function matches(row: object, where: Record<string, unknown> | undefined): boolean {
    if (!where) {
      return true;
    }
    return Object.entries(where).every(([key, value]) => {
      if (key === 'NOT') {
        const excluded = value as { id?: string };
        return excluded.id === undefined || (row as { id?: string }).id !== excluded.id;
      }
      const actual = (row as Record<string, unknown>)[key];
      return actual === value || (value === null && actual === undefined);
    });
  }

  function client(order: string[]) {
    return {
      async $queryRaw(strings: TemplateStringsArray) {
        const text = strings.join(' ');
        if (text.includes('rider_profiles')) {
          order.push('rider');
        } else if (text.includes('AND')) {
          order.push('motorcycle');
        } else if (text.includes('motorcycles')) {
          order.push('motorcycles');
        }
        return [];
      },
      riderProfile: {
        async findUnique({ where }: { where: { id: string } }) {
          return profiles.find((row) => row.id === where.id) ?? null;
        },
        async update({ where, data }: { where: { id: string }; data: { availability?: RiderAvailability } }) {
          const row = profiles.find((candidate) => candidate.id === where.id);
          if (!row) {
            throw new Error('missing profile');
          }
          if (data.availability !== undefined && data.availability !== RiderAvailability.OFFLINE) {
            throw new Error('rider profile must not be updated');
          }
          profileWrites += 1;
          Object.assign(row, data);
          return { ...row };
        },
      },
      deliveryAssignment: {
        async findFirst({ where }: { where: Record<string, unknown> }) {
          return assignments.find((row) => matches(row, where)) ?? null;
        },
      },
      motorcycle: {
        async create({ data }: { data: MotorcycleRow }) {
          if (motorcycles.some((row) => row.registrationNumber === data.registrationNumber)) {
            throw { code: 'P2002' };
          }
          const row: MotorcycleRow = {
            ...data,
            verifiedAt: data.verifiedAt ?? null,
            verifiedById: data.verifiedById ?? null,
            rejectedAt: data.rejectedAt ?? null,
            rejectedById: data.rejectedById ?? null,
            revokedAt: data.revokedAt ?? null,
            revokedById: data.revokedById ?? null,
            removedAt: data.removedAt ?? null,
          };
          motorcycles.push(row);
          return { ...row };
        },
        async findMany({ where, orderBy }: { where?: Record<string, unknown>; orderBy?: { createdAt: 'asc' } }) {
          const rows = motorcycles.filter((row) => matches(row, where));
          if (orderBy?.createdAt === 'asc') {
            rows.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
          }
          return rows.map((row) => ({ ...row }));
        },
        async findFirst({ where }: { where: Record<string, unknown> }) {
          const row = motorcycles.find((candidate) => matches(candidate, where));
          return row ? { ...row } : null;
        },
        async findUnique({ where }: { where: { id: string } }) {
          const row = motorcycles.find((candidate) => candidate.id === where.id);
          return row ? { ...row } : null;
        },
        async update({ where, data }: { where: { id: string }; data: Partial<MotorcycleRow> }) {
          const row = motorcycles.find((candidate) => candidate.id === where.id);
          if (!row) {
            throw new Error('missing motorcycle');
          }
          if (data.registrationNumber && data.registrationNumber !== row.registrationNumber && motorcycles.some((candidate) => candidate.registrationNumber === data.registrationNumber)) {
            throw { code: 'P2002' };
          }
          if (data.isActive === true && motorcycles.some((candidate) => candidate.id !== row.id && candidate.riderProfileId === row.riderProfileId && candidate.isActive)) {
            throw { code: 'P2002' };
          }
          const nextActive = data.isActive ?? row.isActive;
          const nextStatus = data.verificationStatus ?? row.verificationStatus;
          if (nextActive && nextStatus !== MotorcycleVerificationStatus.VERIFIED) {
            throw new Error('active requires verified');
          }
          Object.assign(row, data);
          return { ...row };
        },
        async updateMany({ where, data }: { where: Record<string, unknown>; data: Partial<MotorcycleRow> }) {
          const rows = motorcycles.filter((row) => matches(row, where));
          for (const row of rows) {
            Object.assign(row, data);
          }
          return { count: rows.length };
        },
        async delete({ where }: { where: { id: string } }) {
          const index = motorcycles.findIndex((row) => row.id === where.id);
          if (index >= 0) {
            motorcycles.splice(index, 1);
          }
        },
      },
    };
  }

  const db = {
    motorcycle: client([]).motorcycle,
    async $transaction<T>(fn: (tx: ReturnType<typeof client>) => Promise<T>): Promise<T> {
      const run = tail.then(async () => {
        const order: string[] = [];
        const result = await fn(client(order));
        lockOrders.push(order);
        return result;
      });
      tail = run.then(() => undefined, () => undefined);
      return run;
    },
  };

  return {
    service: new MotorcycleService(db as unknown as PrismaService),
    review: new MotorcycleReviewService(db as unknown as PrismaService),
    motorcycles,
    assignments,
    profile,
    lockOrders,
    get profileWrites() {
      return profileWrites;
    },
    addAssignment(assignment: AssignmentRow) {
      const motorcycle = motorcycles.find((row) => row.id === assignment.motorcycleId) ?? null;
      if (!assignmentMotorcycleConstraintHolds(assignment.status, assignment.motorcycleId)) {
        throw new Error('assignment motorcycle constraint');
      }
      if (!motorcycleOwnerConstraintHolds(assignment, motorcycle)) {
        throw new Error('motorcycle owner constraint');
      }
      assignments.push(assignment);
    },
    forceActive(id: string) {
      const row = motorcycles.find((candidate) => candidate.id === id);
      if (!row) {
        throw new Error('missing motorcycle');
      }
      if (motorcycles.some((candidate) => candidate.id !== row.id && candidate.riderProfileId === row.riderProfileId && candidate.isActive)) {
        throw { code: 'P2002' };
      }
      row.isActive = true;
    },
  };
}
