import { describe, expect, it } from 'vitest';
import {
  AccountStatus,
  LicenceReviewDecision,
  MotorcycleVerificationStatus,
  RiderApprovalStatus,
  RiderAvailability,
  RiderVerificationStatus,
  UserRole,
} from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { RiderContext } from '../auth/rider-access.service.js';
import { RiderOnboardingService } from './rider-onboarding.service.js';

const RIDER: RiderContext = { userId: 'user-1', riderProfileId: 'profile-1' };

describe('rider onboarding', () => {
  it('returns the rider status and latest rejection without private review details', async () => {
    const ctx = context();
    ctx.reviews.push({
      riderProfileId: 'profile-1',
      decision: LicenceReviewDecision.REJECT,
      rejectionReason: 'The photo is unreadable',
      reviewerId: 'admin-1',
      createdAt: new Date('2026-10-13T11:00:00.000Z'),
    });
    ctx.motorcycles.push(
      { riderProfileId: 'profile-1', verificationStatus: MotorcycleVerificationStatus.VERIFIED, isActive: false },
      { riderProfileId: 'profile-1', verificationStatus: MotorcycleVerificationStatus.PENDING, isActive: false },
    );

    const response = await ctx.service.current(RIDER);

    expect(response).toEqual({
      licenceVerificationStatus: RiderVerificationStatus.REJECTED,
      approvalStatus: RiderApprovalStatus.PENDING,
      availability: RiderAvailability.OFFLINE,
      licenceNumber: null,
      licenceClass: null,
      rejectionReason: 'The photo is unreadable',
      verifiedMotorcycleCount: 1,
      activeVerifiedMotorcycle: false,
    });
    const json = JSON.stringify(response);
    expect(json).not.toContain('admin-1');
    expect(json).not.toContain('reviewerId');
    expect(json).not.toContain('objectKey');
    expect(json).not.toContain('bucket');
  });

  it('returns the registered name and phone without a write', async () => {
    const ctx = context();
    await expect(ctx.service.profile(RIDER)).resolves.toEqual({
      fullName: 'Tendai Moyo',
      phone: '+263771234567',
      address: null,
      hasProfilePhoto: false,
    });
    expect(ctx.userUpdates).toBe(0);
  });

  it('returns the address saved with the rider profile', async () => {
    const ctx = context();
    ctx.profile!.address = '12 Samora Machel Avenue';
    await expect(ctx.service.profile(RIDER)).resolves.toEqual({
      fullName: 'Tendai Moyo',
      phone: '+263771234567',
      address: '12 Samora Machel Avenue',
      hasProfilePhoto: false,
    });
  });

  it('returns the customer address for a customer who also has a rider profile', async () => {
    const ctx = context();
    ctx.user.role = UserRole.CUSTOMER;
    ctx.customerAddress = '1 First Street';
    await expect(ctx.service.profile(RIDER)).resolves.toEqual({
      fullName: 'Tendai Moyo',
      phone: '+263771234567',
      address: '1 First Street',
      hasProfilePhoto: false,
    });
  });

  it('refuses a profile read when the account is not an active rider', async () => {
    const ctx = context();
    ctx.user.accountStatus = AccountStatus.DEACTIVATED;
    await expect(ctx.service.profile(RIDER)).rejects.toThrow('Rider access is required');
  });

  it('hides an older rejection after the latest review verifies the licence', async () => {
    const ctx = context();
    ctx.profile.verificationStatus = RiderVerificationStatus.VERIFIED;
    ctx.profile.licenceNumber = 'ZW 100';
    ctx.profile.licenceClass = '4';
    ctx.reviews.push(
      {
        riderProfileId: 'profile-1',
        decision: LicenceReviewDecision.REJECT,
        rejectionReason: 'The photo is unreadable',
        reviewerId: 'admin-1',
        createdAt: new Date('2026-10-13T11:00:00.000Z'),
      },
      {
        riderProfileId: 'profile-1',
        decision: LicenceReviewDecision.VERIFY,
        rejectionReason: null,
        reviewerId: 'admin-2',
        createdAt: new Date('2026-10-13T12:00:00.000Z'),
      },
    );
    ctx.motorcycles.push({ riderProfileId: 'profile-1', verificationStatus: MotorcycleVerificationStatus.VERIFIED, isActive: true });

    await expect(ctx.service.current(RIDER)).resolves.toMatchObject({
      licenceVerificationStatus: RiderVerificationStatus.VERIFIED,
      licenceNumber: 'ZW 100',
      licenceClass: '4',
      rejectionReason: null,
      verifiedMotorcycleCount: 1,
      activeVerifiedMotorcycle: true,
    });
  });

  it('includes receiving only while the marketplace flag is on', async () => {
    const previous = process.env.V2_MARKETPLACE_ENABLED;
    const ctx = context();
    ctx.profile.receivingRequests = true;
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    try {
      await expect(ctx.service.current(RIDER)).resolves.toMatchObject({ receiving: true, availability: RiderAvailability.OFFLINE });
      ctx.profile.receivingRequests = false;
      await expect(ctx.service.current(RIDER)).resolves.toMatchObject({ receiving: false });
    } finally {
      if (previous === undefined) delete process.env.V2_MARKETPLACE_ENABLED;
      else process.env.V2_MARKETPLACE_ENABLED = previous;
    }
    await expect(ctx.service.current(RIDER)).resolves.not.toHaveProperty('receiving');
  });
});

type ProfileRow = {
  id: string;
  userId: string;
  verificationStatus: RiderVerificationStatus;
  approvalStatus: RiderApprovalStatus;
  availability: RiderAvailability;
  receivingRequests?: boolean | null;
  licenceNumber: string | null;
  licenceClass: string | null;
  address?: string | null;
};

type ReviewRow = {
  riderProfileId: string;
  decision: LicenceReviewDecision;
  rejectionReason: string | null;
  reviewerId: string;
  createdAt: Date;
};

function context() {
  const profiles: ProfileRow[] = [{
    id: 'profile-1',
    userId: 'user-1',
    verificationStatus: RiderVerificationStatus.REJECTED,
    approvalStatus: RiderApprovalStatus.PENDING,
    availability: RiderAvailability.OFFLINE,
    licenceNumber: null,
    licenceClass: null,
  }];
  const reviews: ReviewRow[] = [];
  const motorcycles: Array<{ riderProfileId: string; verificationStatus: MotorcycleVerificationStatus; isActive: boolean }> = [];
  const user: {
    id: string;
    fullName: string;
    phone: string;
    role: UserRole;
    accountStatus: AccountStatus;
  } = {
    id: 'user-1',
    fullName: 'Tendai Moyo',
    phone: '+263771234567',
    role: UserRole.RIDER,
    accountStatus: AccountStatus.ACTIVE,
  };
  const state = { customerAddress: null as string | null };
  let userUpdates = 0;
  const db = {
    authChallenge: {
      async findFirst() {
        return null;
      },
    },
    customerAccount: {
      async findUnique() {
        return state.customerAddress === null ? null : { address: state.customerAddress };
      },
    },
    user: {
      async findUnique({ where }: { where: { id: string } }) {
        return user.id === where.id ? user : null;
      },
      async update() {
        userUpdates += 1;
        return user;
      },
    },
    riderProfilePhoto: {
      async findFirst() {
        return null;
      },
    },
    riderProfile: {
      async findUnique({ where }: { where: { id?: string; userId?: string } }) {
        return profiles.find((profile) => {
          if (where.id !== undefined) {
            return profile.id === where.id;
          }
          if (where.userId !== undefined) {
            return profile.userId === where.userId;
          }
          return false;
        }) ?? null;
      },
    },
    riderLicenceReview: {
      async findMany({ where, orderBy, take }: { where: { riderProfileId: string }; orderBy: { createdAt: 'asc' | 'desc' }; take: number }) {
        const matched = reviews.filter((row) => row.riderProfileId === where.riderProfileId);
        matched.sort((left, right) => orderBy.createdAt === 'desc'
          ? right.createdAt.getTime() - left.createdAt.getTime()
          : left.createdAt.getTime() - right.createdAt.getTime());
        return matched.slice(0, take);
      },
    },
    motorcycle: {
      async count({ where }: { where: { riderProfileId: string; verificationStatus: MotorcycleVerificationStatus; isActive?: boolean } }) {
        return motorcycles.filter((row) => row.riderProfileId === where.riderProfileId
          && row.verificationStatus === where.verificationStatus
          && (where.isActive === undefined || row.isActive === where.isActive)).length;
      },
    },
  };
  return {
    service: new RiderOnboardingService(db as unknown as PrismaService),
    reviews,
    motorcycles,
    get profile() {
      return profiles[0];
    },
    user,
    get customerAddress() {
      return state.customerAddress;
    },
    set customerAddress(value: string | null) {
      state.customerAddress = value;
    },
    get userUpdates() {
      return userUpdates;
    },
  };
}
