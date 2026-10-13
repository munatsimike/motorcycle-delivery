import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, RiderAvailability } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RiderContext } from '../auth/rider-access.service.js';
import { motorcycleForAcceptance, type AcceptanceRider } from './motorcycle-eligibility.js';
import { hasAcceptedAssignment, lockRiderMotorcycles, lockRiderProfile } from './motorcycle-lock.js';

export const AVAILABILITY_NO_LONGER_ELIGIBLE_REASON = 'no_longer_eligible';
export const AVAILABILITY_NO_LONGER_ELIGIBLE_MESSAGE = 'Rider is no longer eligible to be online';

export type RiderAvailabilityResponse = {
  availability: RiderAvailability;
  eligible?: false;
  reason?: typeof AVAILABILITY_NO_LONGER_ELIGIBLE_REASON;
  message?: string;
};

@Injectable()
export class RiderAvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async online(rider: RiderContext, now = new Date()): Promise<RiderAvailabilityResponse> {
    return this.prisma.$transaction((tx) => goOnline(tx, rider, now));
  }

  async offline(rider: RiderContext, now = new Date()): Promise<RiderAvailabilityResponse> {
    return this.prisma.$transaction((tx) => goOffline(tx, rider, now));
  }
}

async function goOnline(tx: Prisma.TransactionClient, rider: RiderContext, now: Date): Promise<RiderAvailabilityResponse> {
  const profile = await lockedProfile(tx, rider);
  if (profile.availability === RiderAvailability.BUSY) {
    throw new ConflictException('Availability cannot be changed while busy');
  }
  const eligibility = await readEligibility(tx, profile);
  if (profile.availability === RiderAvailability.AVAILABLE) {
    return reconcileAvailable(tx, profile.id, eligibility, now);
  }
  motorcycleForAcceptance(eligibility);
  await tx.riderProfile.update({
    where: { id: profile.id },
    data: { availability: RiderAvailability.AVAILABLE, updatedAt: now },
  });
  return { availability: RiderAvailability.AVAILABLE };
}

async function reconcileAvailable(
  tx: Prisma.TransactionClient,
  riderProfileId: string,
  eligibility: AcceptanceRider,
  now: Date,
): Promise<RiderAvailabilityResponse> {
  try {
    motorcycleForAcceptance(eligibility);
  } catch (error) {
    if (!(error instanceof ConflictException)) {
      throw error;
    }
    if (await hasAcceptedAssignment(tx, riderProfileId)) {
      throw new ConflictException('You cannot go offline during a delivery');
    }
    await tx.riderProfile.update({
      where: { id: riderProfileId },
      data: { availability: RiderAvailability.OFFLINE, updatedAt: now },
    });
    return {
      availability: RiderAvailability.OFFLINE,
      eligible: false,
      reason: AVAILABILITY_NO_LONGER_ELIGIBLE_REASON,
      message: AVAILABILITY_NO_LONGER_ELIGIBLE_MESSAGE,
    };
  }
  return { availability: RiderAvailability.AVAILABLE };
}

async function goOffline(tx: Prisma.TransactionClient, rider: RiderContext, now: Date): Promise<RiderAvailabilityResponse> {
  const profile = await lockedProfile(tx, rider);
  if (profile.availability === RiderAvailability.BUSY) {
    throw new ConflictException('Availability cannot be changed while busy');
  }
  if (profile.availability === RiderAvailability.OFFLINE) {
    return { availability: RiderAvailability.OFFLINE };
  }
  if (await hasAcceptedAssignment(tx, profile.id)) {
    throw new ConflictException('You cannot go offline during a delivery');
  }
  await tx.riderProfile.update({
    where: { id: profile.id },
    data: { availability: RiderAvailability.OFFLINE, updatedAt: now },
  });
  return { availability: RiderAvailability.OFFLINE };
}

async function lockedProfile(tx: Prisma.TransactionClient, rider: RiderContext) {
  const profile = await lockRiderProfile(tx, rider.riderProfileId, 'Rider profile not found');
  if (profile.userId !== rider.userId) {
    throw new ForbiddenException('Rider access is required');
  }
  await lockRiderMotorcycles(tx, profile.id);
  return profile;
}

async function readEligibility(
  tx: Prisma.TransactionClient,
  profile: { id: string; userId: string; approvalStatus: AcceptanceRider['approvalStatus']; verificationStatus: AcceptanceRider['licenceVerificationStatus'] },
): Promise<AcceptanceRider> {
  const user = await tx.user.findUnique({ where: { id: profile.userId } });
  if (!user || user.id !== profile.userId) {
    throw new ForbiddenException('Rider access is required');
  }
  const motorcycles = await tx.motorcycle.findMany({
    where: { riderProfileId: profile.id },
    select: { id: true, verificationStatus: true, isActive: true },
  });
  return {
    accountStatus: user.accountStatus,
    phoneVerifiedAt: user.phoneVerifiedAt,
    approvalStatus: profile.approvalStatus,
    licenceVerificationStatus: profile.verificationStatus,
    motorcycles,
  };
}
