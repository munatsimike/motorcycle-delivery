import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AssignmentStatus, Prisma, RiderAvailability } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RiderContext } from '../auth/rider-access.service.js';
import { v2MarketplaceEnabled } from '../auth/v2-flags.js';
import { motorcycleForAcceptance, type AcceptanceRider } from './motorcycle-eligibility.js';
import { lockRiderMotorcycles, lockRiderProfile } from './motorcycle-lock.js';

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
    const result = receiving ? await this.online(rider, now) : await this.offline(rider, now);
    return { availability: result.availability, receiving: result.receiving === true };
  }
}

async function goOnline(tx: Prisma.TransactionClient, rider: RiderContext, now: Date): Promise<RiderAvailabilityResponse> {
  const profile = await lockedProfile(tx, rider);
  if (profile.availability === RiderAvailability.BUSY && await legacyBusyLock(tx, profile.id)) {
    throw new ConflictException('Availability cannot be changed while busy');
  }
  const eligibility = await readEligibility(tx, profile);
  if (profile.availability === RiderAvailability.AVAILABLE) {
    return reconcileAvailable(tx, profile, eligibility, now);
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
  profile: { id: string; receivingRequests: boolean | null },
  eligibility: AcceptanceRider,
  now: Date,
): Promise<RiderAvailabilityResponse> {
  try {
    motorcycleForAcceptance(eligibility);
  } catch (error) {
    if (!(error instanceof ConflictException)) {
      throw error;
    }
    await tx.riderProfile.update({
      where: { id: profile.id },
      data: offlineData(now),
    });
    return {
      ...offlineResponse(false),
      eligible: false,
      reason: AVAILABILITY_NO_LONGER_ELIGIBLE_REASON,
      message: AVAILABILITY_NO_LONGER_ELIGIBLE_MESSAGE,
    };
  }
  if (!v2MarketplaceEnabled()) {
    return { availability: RiderAvailability.AVAILABLE };
  }
  if (profile.receivingRequests === true) {
    return { availability: RiderAvailability.AVAILABLE, receiving: true };
  }
  await tx.riderProfile.update({
    where: { id: profile.id },
    data: { receivingRequests: true, updatedAt: now },
  });
  return { availability: RiderAvailability.AVAILABLE, receiving: true };
}

async function goOffline(tx: Prisma.TransactionClient, rider: RiderContext, now: Date): Promise<RiderAvailabilityResponse> {
  const profile = await lockedProfile(tx, rider);
  if (!v2MarketplaceEnabled()) {
    if (profile.availability === RiderAvailability.OFFLINE) {
      return { availability: RiderAvailability.OFFLINE };
    }
    await tx.riderProfile.update({
      where: { id: profile.id },
      data: { availability: RiderAvailability.OFFLINE, updatedAt: now },
    });
    return { availability: RiderAvailability.OFFLINE };
  }
  if (profile.availability === RiderAvailability.OFFLINE && profile.receivingRequests === false) {
    return { availability: RiderAvailability.OFFLINE, receiving: false };
  }
  await tx.riderProfile.update({
    where: { id: profile.id },
    data: offlineData(now),
  });
  return { availability: RiderAvailability.OFFLINE, receiving: false };
}

async function legacyBusyLock(tx: Prisma.TransactionClient, riderProfileId: string): Promise<boolean> {
  if (!v2MarketplaceEnabled()) {
    return true;
  }
  const legacy = await tx.deliveryAssignment.findFirst({
    where: {
      riderProfileId,
      status: AssignmentStatus.ACCEPTED,
      acceptedBidAmount: null,
    },
    select: { id: true },
  });
  return legacy != null;
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
  if (v2MarketplaceEnabled()) {
    return { availability: RiderAvailability.AVAILABLE, receivingRequests: true, updatedAt: now };
  }
  return { availability: RiderAvailability.AVAILABLE, updatedAt: now };
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

function offlineResponse(receivingRequests: boolean | null): RiderAvailabilityResponse {
  if (!v2MarketplaceEnabled() || receivingRequests == null) {
    return { availability: RiderAvailability.OFFLINE };
  }
  return { availability: RiderAvailability.OFFLINE, receiving: receivingRequests };
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
