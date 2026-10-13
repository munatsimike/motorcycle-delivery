import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  AssignmentStatus,
  MotorcycleVerificationStatus,
  RiderApprovalStatus,
  RiderAvailability,
  RiderVerificationStatus,
} from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { RiderApprovalService } from './rider-approval.service.js';

const NOW = new Date('2026-10-13T12:00:00.000Z');
const ADMIN = { userId: 'admin-1' };

describe('rider approval', () => {
  it('approves a verified rider without an active motorcycle and stays offline', async () => {
    const ctx = context();
    ctx.motorcycles.push({ id: 'bike-1', riderProfileId: 'profile-1', verificationStatus: MotorcycleVerificationStatus.VERIFIED, isActive: false });
    ctx.profile.verificationStatus = RiderVerificationStatus.VERIFIED;

    await expect(ctx.service.decide(ADMIN, 'profile-1', 'APPROVE', NOW)).resolves.toEqual({
      riderProfileId: 'profile-1',
      approvalStatus: RiderApprovalStatus.APPROVED,
      availability: RiderAvailability.OFFLINE,
      verificationStatus: RiderVerificationStatus.VERIFIED,
    });
    expect(ctx.profile.availability).toBe(RiderAvailability.OFFLINE);
  });

  it('refuses approval without a verified licence or a verified motorcycle', async () => {
    const pending = context();
    pending.motorcycles.push({ id: 'bike-1', riderProfileId: 'profile-1', verificationStatus: MotorcycleVerificationStatus.VERIFIED, isActive: true });
    await expect(pending.service.decide(ADMIN, 'profile-1', 'APPROVE', NOW)).rejects.toBeInstanceOf(ConflictException);
    expect(pending.profile.approvalStatus).toBe(RiderApprovalStatus.PENDING);

    const unlicensed = context();
    unlicensed.profile.verificationStatus = RiderVerificationStatus.VERIFIED;
    await expect(unlicensed.service.decide(ADMIN, 'profile-1', 'APPROVE', NOW)).rejects.toBeInstanceOf(ConflictException);
    expect(unlicensed.profile.approvalStatus).toBe(RiderApprovalStatus.PENDING);
  });

  it('suspends an approved rider and refuses suspension during an accepted delivery', async () => {
    const ctx = context();
    ctx.profile.approvalStatus = RiderApprovalStatus.APPROVED;
    ctx.profile.availability = RiderAvailability.AVAILABLE;
    ctx.assignments.push({ id: 'delivery-1', riderProfileId: 'profile-1', status: AssignmentStatus.ACCEPTED });

    await expect(ctx.service.decide(ADMIN, 'profile-1', 'SUSPEND', NOW)).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.profile).toMatchObject({
      approvalStatus: RiderApprovalStatus.APPROVED,
      availability: RiderAvailability.AVAILABLE,
    });

    ctx.assignments[0].status = AssignmentStatus.OFFERED;
    await expect(ctx.service.decide(ADMIN, 'profile-1', 'SUSPEND', NOW)).resolves.toMatchObject({
      approvalStatus: RiderApprovalStatus.SUSPENDED,
      availability: RiderAvailability.OFFLINE,
    });
  });
});

type ProfileRow = {
  id: string;
  verificationStatus: RiderVerificationStatus;
  approvalStatus: RiderApprovalStatus;
  availability: RiderAvailability;
};

function context() {
  const profiles: ProfileRow[] = [{
    id: 'profile-1',
    verificationStatus: RiderVerificationStatus.PENDING,
    approvalStatus: RiderApprovalStatus.PENDING,
    availability: RiderAvailability.OFFLINE,
  }];
  const motorcycles: Array<{ id: string; riderProfileId: string; verificationStatus: MotorcycleVerificationStatus; isActive: boolean }> = [];
  const assignments: Array<{ id: string; riderProfileId: string; status: AssignmentStatus }> = [];
  const db = {
    riderProfile: {
      async findUnique({ where }: { where: { id: string } }) {
        return profiles.find((profile) => profile.id === where.id) ?? null;
      },
      async update({ where, data }: { where: { id: string }; data: Partial<ProfileRow> }) {
        const profile = profiles.find((row) => row.id === where.id);
        if (!profile) throw new Error('profile missing');
        Object.assign(profile, data);
        return profile;
      },
    },
    motorcycle: {
      async count({ where }: { where: { riderProfileId: string; verificationStatus: MotorcycleVerificationStatus } }) {
        return motorcycles.filter((row) => row.riderProfileId === where.riderProfileId && row.verificationStatus === where.verificationStatus).length;
      },
    },
    deliveryAssignment: {
      async findFirst({ where }: { where: { riderProfileId: string; status: AssignmentStatus } }) {
        return assignments.find((row) => row.riderProfileId === where.riderProfileId && row.status === where.status) ?? null;
      },
    },
    async $queryRaw() {
      return [];
    },
    async $transaction<T>(callback: (tx: typeof db) => Promise<T>) {
      return callback(db);
    },
  };
  return {
    service: new RiderApprovalService(db as unknown as PrismaService),
    motorcycles,
    assignments,
    get profile() {
      return profiles[0];
    },
  };
}
