import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AssignmentStatus, Prisma, RiderAvailability } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RiderContext } from '../auth/rider-access.service.js';
import { v2MarketplaceEnabled } from '../auth/v2-flags.js';
import { motorcycleForAcceptance, type AcceptanceRider } from './motorcycle-eligibility.js';
import { hasAcceptedAssignment, lockRiderMotorcycles, lockRiderProfile } from './motorcycle-lock.js';

export const AVAILABILITY_NO_LONGER_ELIGIBLE_REASON = 'no_longer_eligible';
export const AVAILABILITY_NO_LONGER_ELIGIBLE_MESSAGE = 'Rider is no longer eligible to be online';

export type RiderAvailabilityResponse = {
  availability: RiderAvailability;
  receiving?: boolean;
  eligible?: false;
  reason?: typeof AVAILABILITY_NO_LONGER_ELIGIBLE_REASON;
  message?: string;
};

export type ReceivingPreferenceResponse = {
  availability: RiderAvailability;
  receiving: boolean;
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

  async setReceiving(rider: RiderContext, body: unknown, now = new Date()): Promise<ReceivingPreferenceResponse> {
    if (!v2MarketplaceEnabled()) {
      throw new NotFoundException('Bidding is not available');
    }
    const receiving = readReceiving(body);
    return this.prisma.$transaction((tx) => setReceiving(tx, rider, receiving, now));
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
    data: onlineData(now),
  });
  return onlineResponse();
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
    if (await acceptedAssignmentBlocksOffline(tx, riderProfileId)) {
      throw new ConflictException('You cannot go offline during a delivery');
    }
    await tx.riderProfile.update({
      where: { id: riderProfileId },
      data: offlineData(now),
    });
    return {
      ...offlineResponse(),
      eligible: false,
      reason: AVAILABILITY_NO_LONGER_ELIGIBLE_REASON,
      message: AVAILABILITY_NO_LONGER_ELIGIBLE_MESSAGE,
    };
  }
  if (!v2MarketplaceEnabled()) {
    return { availability: RiderAvailability.AVAILABLE };
  }
  await tx.riderProfile.update({
    where: { id: riderProfileId },
    data: { receivingRequests: true, updatedAt: now },
  });
  return { availability: RiderAvailability.AVAILABLE, receiving: true };
}

async function goOffline(tx: Prisma.TransactionClient, rider: RiderContext, now: Date): Promise<RiderAvailabilityResponse> {
  const profile = await lockedProfile(tx, rider);
  if (profile.availability === RiderAvailability.BUSY) {
    throw new ConflictException('Availability cannot be changed while busy');
  }
  if (profile.availability === RiderAvailability.OFFLINE) {
    if (v2MarketplaceEnabled() && profile.receivingRequests !== false) {
      await tx.riderProfile.update({
        where: { id: profile.id },
        data: { receivingRequests: false, updatedAt: now },
      });
      return { availability: RiderAvailability.OFFLINE, receiving: false };
    }
    return { availability: RiderAvailability.OFFLINE };
  }
  if (await acceptedAssignmentBlocksOffline(tx, profile.id)) {
    throw new ConflictException('You cannot go offline during a delivery');
  }
  await tx.riderProfile.update({
    where: { id: profile.id },
    data: offlineData(now),
  });
  return offlineResponse();
}

async function setReceiving(
  tx: Prisma.TransactionClient,
  rider: RiderContext,
  receiving: boolean,
  now: Date,
): Promise<ReceivingPreferenceResponse> {
  const profile = await lockedProfile(tx, rider);
  if (profile.availability === RiderAvailability.BUSY) {
    throw new ConflictException('Availability cannot be changed while busy');
  }
  if (profile.availability !== RiderAvailability.AVAILABLE) {
    throw new ConflictException('Receiving requests can be changed while you are online');
  }
  motorcycleForAcceptance(await readEligibility(tx, profile));
  await tx.riderProfile.update({
    where: { id: profile.id },
    data: { receivingRequests: receiving, updatedAt: now },
  });
  return { availability: profile.availability, receiving };
}

async function lockedProfile(tx: Prisma.TransactionClient, rider: RiderContext) {
  const profile = await lockRiderProfile(tx, rider.riderProfileId, 'Rider profile not found');
  if (profile.userId !== rider.userId) {
    throw new ForbiddenException('Rider access is required');
  }
  await lockRiderMotorcycles(tx, profile.id);
  return profile;
}

function onlineData(now: Date): { availability: RiderAvailability; updatedAt: Date; receivingRequests?: boolean } {
  return v2MarketplaceEnabled()
    ? { availability: RiderAvailability.AVAILABLE, receivingRequests: true, updatedAt: now }
    : { availability: RiderAvailability.AVAILABLE, updatedAt: now };
}

function offlineData(now: Date): { availability: RiderAvailability; updatedAt: Date; receivingRequests?: boolean } {
  return v2MarketplaceEnabled()
    ? { availability: RiderAvailability.OFFLINE, receivingRequests: false, updatedAt: now }
    : { availability: RiderAvailability.OFFLINE, updatedAt: now };
}

function onlineResponse(): RiderAvailabilityResponse {
  return v2MarketplaceEnabled()
    ? { availability: RiderAvailability.AVAILABLE, receiving: true }
    : { availability: RiderAvailability.AVAILABLE };
}

function offlineResponse(): RiderAvailabilityResponse {
  return v2MarketplaceEnabled()
    ? { availability: RiderAvailability.OFFLINE, receiving: false }
    : { availability: RiderAvailability.OFFLINE };
}

async function acceptedAssignmentBlocksOffline(tx: Prisma.TransactionClient, riderProfileId: string): Promise<boolean> {
  if (!v2MarketplaceEnabled()) return hasAcceptedAssignment(tx, riderProfileId);
  const v1Accepted = await tx.deliveryAssignment.findFirst({
    where: { riderProfileId, status: AssignmentStatus.ACCEPTED, acceptedBidAmount: null },
    select: { id: true },
  });
  return v1Accepted !== null;
}

function readReceiving(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('receiving must be a boolean');
  }
  const receiving = (body as { receiving?: unknown }).receiving;
  if (typeof receiving !== 'boolean') {
    throw new BadRequestException('receiving must be a boolean');
  }
  return receiving;
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
