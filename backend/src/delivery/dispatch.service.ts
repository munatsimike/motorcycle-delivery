import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssignmentReleaseReason,
  AssignmentStatus,
  Currency,
  DeliveryActorType,
  DeliveryStatus,
  DispatchRoundStatus,
  Prisma,
  RiderAvailability,
} from '../generated/prisma/client.js';
import type { CustomerContext } from '../auth/customer-access.service.js';
import type { RiderContext } from '../auth/rider-access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { motorcycleForAcceptance, type AcceptanceRider } from '../rider/motorcycle-eligibility.js';
import { lockRiderProfile } from '../rider/motorcycle-lock.js';
import {
  IDEMPOTENCY_CONFLICT,
  isUniqueViolation,
  openPlatformFeeReservation,
  releasePlatformFeeReservation,
  capturePlatformFeeReservation,
} from '../rider/wallet-ledger.js';
import { findDispatchCandidates } from './dispatch-query.js';
import {
  AUTO_RETRY_MAX_COUNT,
  AUTO_RETRY_DELAY_MS,
  DISPATCH_ROUND_DELAYS_MS,
  DISPATCH_ROUND_RADII_METRES,
  GPS_FRESH_MS,
  OFFER_TTL_MS,
  gpsIsFresh,
  offerIsOpen,
} from './dispatch.constants.js';
import { centsFromDecimal, formatCents } from './money.js';

const RIDER_RELEASE_REASONS = new Set<AssignmentReleaseReason>([
  AssignmentReleaseReason.RIDER_CANCELLED,
  AssignmentReleaseReason.VEHICLE_PROBLEM,
]);

const CANCELLABLE = new Set<DeliveryStatus>([
  DeliveryStatus.CREATED,
  DeliveryStatus.SEARCHING,
  DeliveryStatus.ASSIGNED,
  DeliveryStatus.ARRIVED_AT_PICKUP,
]);

const RELEASEABLE = new Set<DeliveryStatus>([
  DeliveryStatus.ASSIGNED,
  DeliveryStatus.ARRIVED_AT_PICKUP,
]);

const DELIVERY_PROGRESS = [
  DeliveryStatus.ASSIGNED,
  DeliveryStatus.ARRIVED_AT_PICKUP,
  DeliveryStatus.PICKED_UP,
  DeliveryStatus.IN_TRANSIT,
  DeliveryStatus.ARRIVED_AT_DROPOFF,
  DeliveryStatus.DELIVERED,
] as const;

type AssignmentRow = {
  id: string;
  deliveryId: string;
  riderProfileId: string;
  status: AssignmentStatus;
  offerExpiresAt: Date;
  respondedAt: Date | null;
  searchGeneration: number | null;
  idempotencyKey: string | null;
  payloadHash: string | null;
  acceptedPlatformFee: string | { toFixed(digits: number): string } | null;
  acceptedFeeConfigVersion: number | null;
};

type DeliveryRow = {
  id: string;
  customerId: string;
  status: DeliveryStatus;
  searchGeneration: number;
  price: string | { toFixed(digits: number): string };
  currency: Currency;
  payer: string;
  paymentMethod: string;
  parcelDescription: string;
  parcelSize: string;
  parcelInstructions: string | null;
  pickupAddress: string;
  pickupLatitude: string | { toFixed(digits: number): string };
  pickupLongitude: string | { toFixed(digits: number): string };
  pickupLandmark: string | null;
  pickupInstructions: string | null;
  pickupContactName: string;
  pickupContactPhone: string;
  dropoffAddress: string;
  dropoffLatitude: string | { toFixed(digits: number): string };
  dropoffLongitude: string | { toFixed(digits: number): string };
  dropoffLandmark: string | null;
  dropoffInstructions: string | null;
  recipientName: string;
  recipientPhone: string;
};

type ProfileRow = {
  id: string;
  userId: string;
  approvalStatus: AcceptanceRider['approvalStatus'];
  verificationStatus: AcceptanceRider['licenceVerificationStatus'];
  availability: RiderAvailability;
};

export type RiderOffer = {
  assignmentId: string;
  deliveryId: string;
  expiresAt: string;
  offeredPrice: string;
  currency: Currency;
  payer: string;
  paymentMethod: string;
  parcel: {
    description: string;
    size: string;
    instructions: string | null;
  };
  pickup: StopView;
  dropoff: StopView;
};

type StopView = {
  address: string;
  latitude: string;
  longitude: string;
  landmark: string | null;
  instructions: string | null;
  contactName: string;
  contactPhone: string;
};

export type AcceptanceResult = {
  assignmentId: string;
  deliveryId: string;
  status: typeof DeliveryStatus.ASSIGNED;
  availability: typeof RiderAvailability.BUSY;
  offeredPrice: string;
  currency: typeof Currency.USD;
  reservedFee: string;
  configVersion: number;
  replayed: boolean;
};

export type DeliveryProgress = {
  deliveryId: string;
  status: DeliveryStatus;
  availability: RiderAvailability;
};

@Injectable()
export class DispatchService {
  constructor(private readonly prisma: PrismaService) {}

  search(customer: CustomerContext, deliveryId: string, now = new Date()) {
    return this.prisma.$transaction((tx) => startSearch(tx, customer, deliveryId, now));
  }

  cancel(customer: CustomerContext, deliveryId: string, now = new Date()) {
    return this.prisma.$transaction((tx) => cancelDelivery(tx, customer, deliveryId, now));
  }

  listOffers(rider: RiderContext, now = new Date()) {
    return this.prisma.$transaction((tx) => listOpenOffers(tx, rider, now));
  }

  async accept(rider: RiderContext, assignmentId: string, idempotencyKey: string, now = new Date()) {
    const key = readIdempotencyKey(idempotencyKey);
    const hash = acceptancePayloadHash(assignmentId, rider.riderProfileId);
    try {
      return await this.prisma.$transaction((tx) => acceptOffer(tx, rider, assignmentId, key, hash, now));
    } catch (error) {
      if (error instanceof OfferExpiredError) {
        await this.prisma.$transaction((tx) => persistExpiry(tx, error.deliveryId, error.assignmentId, now));
        throw new ConflictException('This offer has expired');
      }
      if (!isUniqueViolation(error)) {
        throw error;
      }
      return this.prisma.$transaction((tx) => replayAcceptance(tx, rider, key, hash));
    }
  }

  async progress(rider: RiderContext, deliveryId: string, body: unknown, now = new Date()) {
    const requested = readRequestedStatus(body);
    return this.prisma.$transaction((tx) => progressDelivery(tx, rider, deliveryId, requested, now));
  }

  async release(rider: RiderContext, assignmentId: string, body: unknown, now = new Date()) {
    const reason = readReleaseReason(body);
    return this.prisma.$transaction((tx) => releaseDelivery(tx, rider, assignmentId, reason, now));
  }

  processAutoRetry(now = new Date()): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      return processAutoRetry(tx, now);
    });
  }

  processDueRound(now = new Date()): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await claimDueRound(tx, now);
      if (!claimed) {
        return false;
      }
      await executeRound(tx, claimed.id, now);
      return true;
    });
  }
}

class OfferExpiredError extends Error {
  constructor(
    readonly deliveryId: string,
    readonly assignmentId: string,
  ) {
    super('This offer has expired');
  }
}

async function persistExpiry(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  assignmentId: string,
  now: Date,
): Promise<void> {
  await lockDelivery(tx, deliveryId);
  await lockAssignment(tx, assignmentId);
  const assignment = await tx.deliveryAssignment.findUnique({ where: { id: assignmentId } });
  if (!assignment || assignment.status !== AssignmentStatus.OFFERED || offerIsOpen(assignment.offerExpiresAt, now)) {
    return;
  }
  await tx.deliveryAssignment.update({
    where: { id: assignment.id },
    data: { status: AssignmentStatus.EXPIRED },
  });
}

export function acceptancePayloadHash(assignmentId: string, riderProfileId: string): string {
  return createHash('sha256').update(JSON.stringify({ assignmentId, riderProfileId })).digest('hex');
}

export function readRequestedStatus(body: unknown): DeliveryStatus {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Choose a delivery status');
  }
  const status = (body as { status?: unknown }).status;
  if (typeof status !== 'string' || !Object.values(DeliveryStatus).includes(status as DeliveryStatus)) {
    throw new BadRequestException('Choose a delivery status');
  }
  return status as DeliveryStatus;
}

function nextDeliveryStatus(status: DeliveryStatus): DeliveryStatus | null {
  const index = DELIVERY_PROGRESS.indexOf(status as (typeof DELIVERY_PROGRESS)[number]);
  if (index < 0 || index === DELIVERY_PROGRESS.length - 1) {
    return null;
  }
  return DELIVERY_PROGRESS[index + 1] ?? null;
}

// Moves an accepted delivery one step. The caller locks the delivery, then the
// rider profile, then the assignment. Only DELIVERED captures the platform fee,
// and that capture locks the wallet after the assignment. The assignment stays
// ACCEPTED until the fee capture returns, then becomes COMPLETED.
async function progressDelivery(
  tx: Prisma.TransactionClient,
  rider: RiderContext,
  deliveryId: string,
  requested: DeliveryStatus,
  now: Date,
): Promise<DeliveryProgress> {
  const existing = await tx.deliveryAssignment.findFirst({
    where: {
      deliveryId,
      riderProfileId: rider.riderProfileId,
      status: AssignmentStatus.ACCEPTED,
    },
  });
  if (!existing) {
    throw new NotFoundException('Delivery not found');
  }
  await lockDelivery(tx, deliveryId);
  const profile = await lockRiderProfile(tx, rider.riderProfileId, 'Rider profile not found');
  if (profile.userId !== rider.userId) {
    throw new ForbiddenException('Rider access is required');
  }
  await lockAssignment(tx, existing.id);
  const assignment = await tx.deliveryAssignment.findUnique({ where: { id: existing.id } });
  const delivery = await tx.delivery.findUnique({ where: { id: deliveryId } });
  if (
    !assignment
    || assignment.riderProfileId !== rider.riderProfileId
    || assignment.deliveryId !== deliveryId
    || assignment.status !== AssignmentStatus.ACCEPTED
    || !delivery
  ) {
    throw new NotFoundException('Delivery not found');
  }
  if (nextDeliveryStatus(delivery.status) !== requested) {
    throw new ConflictException('This delivery status cannot be changed');
  }
  if (requested === DeliveryStatus.DELIVERED) {
    await capturePlatformFeeReservation(tx, delivery.id, profile.id, now);
  }
  await tx.delivery.update({
    where: { id: delivery.id },
    data: { status: requested, updatedAt: now },
  });
  await recordStatus(
    tx,
    delivery.id,
    delivery.status,
    requested,
    rider.userId,
    DeliveryActorType.RIDER,
    now,
  );
  let availability = profile.availability;
  if (requested === DeliveryStatus.DELIVERED) {
    await tx.deliveryAssignment.update({
      where: { id: assignment.id },
      data: { status: AssignmentStatus.COMPLETED },
    });
    availability = await restoreAvailability(tx, profile, now);
  }
  return {
    deliveryId: delivery.id,
    status: requested,
    availability,
  };
}

export function readReleaseReason(body: unknown): AssignmentReleaseReason {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Choose a release reason');
  }
  const reason = (body as { reason?: unknown }).reason;
  if (typeof reason !== 'string' || !RIDER_RELEASE_REASONS.has(reason as AssignmentReleaseReason)) {
    throw new BadRequestException('Choose a release reason');
  }
  return reason as AssignmentReleaseReason;
}

async function startSearch(
  tx: Prisma.TransactionClient,
  customer: CustomerContext,
  deliveryId: string,
  now: Date,
) {
  await lockDelivery(tx, deliveryId);
  const delivery = await requiredDelivery(tx, deliveryId, customer.customerAccountId);
  if (delivery.status !== DeliveryStatus.CREATED && delivery.status !== DeliveryStatus.NO_RIDER_FOUND) {
    throw new ConflictException('This delivery cannot be searched');
  }
  await expireOffers(tx, delivery.id, null, now);
  const pending = await tx.deliveryDispatchRound.findMany({
    where: { deliveryId: delivery.id, status: DispatchRoundStatus.PENDING },
  });
  if (pending.length > 0) {
    throw new ConflictException('A search is already running');
  }
  const offers = await tx.deliveryAssignment.findMany({
    where: { deliveryId: delivery.id, status: AssignmentStatus.OFFERED },
  });
  if (offers.length > 0) {
    throw new ConflictException('A search is already running');
  }
  const nextGeneration = delivery.searchGeneration + 1;
  const nextStatus = DeliveryStatus.SEARCHING;
  await tx.delivery.update({
    where: { id: delivery.id },
    data: { status: nextStatus, searchGeneration: nextGeneration, autoRetryCount: 0, nextRetryAt: null, searchStartedAt: now, updatedAt: now },
  });
  await recordStatus(tx, delivery.id, delivery.status, nextStatus, customer.userId, DeliveryActorType.CUSTOMER, now);
  await insertRounds(tx, delivery.id, nextGeneration, now);
  return { deliveryId: delivery.id, status: nextStatus, searchGeneration: nextGeneration };
}

async function cancelDelivery(
  tx: Prisma.TransactionClient,
  customer: CustomerContext,
  deliveryId: string,
  now: Date,
) {
  await lockDelivery(tx, deliveryId);
  const delivery = await requiredDelivery(tx, deliveryId, customer.customerAccountId);
  if (!CANCELLABLE.has(delivery.status)) {
    throw new ConflictException('This delivery cannot be cancelled');
  }
  await expireOffers(tx, delivery.id, null, now);
  const accepted = await tx.deliveryAssignment.findFirst({
    where: { deliveryId: delivery.id, status: AssignmentStatus.ACCEPTED },
  });
  if (accepted) {
    const profile = await lockRiderProfile(tx, accepted.riderProfileId, 'Rider profile not found');
    await lockAssignment(tx, accepted.id);
    await releasePlatformFeeReservation(tx, delivery.id, now);
    await tx.deliveryAssignment.update({
      where: { id: accepted.id },
      data: {
        status: AssignmentStatus.RELEASED,
        releaseReason: AssignmentReleaseReason.CUSTOMER_CANCELLED,
        releasedAt: now,
      },
    });
    await restoreAvailability(tx, profile, now);
  }
  await cancelOffered(tx, { deliveryId: delivery.id });
  await tx.delivery.update({
    where: { id: delivery.id },
    data: { status: DeliveryStatus.CANCELLED, updatedAt: now },
  });
  await recordStatus(
    tx,
    delivery.id,
    delivery.status,
    DeliveryStatus.CANCELLED,
    customer.userId,
    DeliveryActorType.CUSTOMER,
    now,
  );
  return { deliveryId: delivery.id, status: DeliveryStatus.CANCELLED };
}

async function listOpenOffers(tx: Prisma.TransactionClient, rider: RiderContext, now: Date) {
  await expireOffers(tx, null, rider.riderProfileId, now);
  const offers = await tx.deliveryAssignment.findMany({
    where: { riderProfileId: rider.riderProfileId, status: AssignmentStatus.OFFERED },
  });
  const visible: RiderOffer[] = [];
  for (const offer of offers) {
    if (!offerIsOpen(offer.offerExpiresAt, now)) {
      continue;
    }
    const delivery = await tx.delivery.findUnique({ where: { id: offer.deliveryId } });
    if (!delivery || delivery.status !== DeliveryStatus.SEARCHING) {
      continue;
    }
    visible.push(toRiderOffer(offer, delivery));
  }
  return { offers: visible };
}

async function acceptOffer(
  tx: Prisma.TransactionClient,
  rider: RiderContext,
  assignmentId: string,
  key: string,
  hash: string,
  now: Date,
): Promise<AcceptanceResult> {
  const existingKey = await tx.deliveryAssignment.findUnique({ where: { idempotencyKey: key } });
  if (existingKey) {
    if (existingKey.payloadHash !== hash || existingKey.riderProfileId !== rider.riderProfileId) {
      throw new ConflictException(IDEMPOTENCY_CONFLICT);
    }
    return acceptanceResult(tx, existingKey, true);
  }
  const offered = await tx.deliveryAssignment.findUnique({ where: { id: assignmentId } });
  if (!offered || offered.riderProfileId !== rider.riderProfileId) {
    throw new NotFoundException('Offer not found');
  }
  await lockDelivery(tx, offered.deliveryId);
  const profile = await lockRiderProfile(tx, rider.riderProfileId, 'Rider profile not found');
  if (profile.userId !== rider.userId) {
    throw new ForbiddenException('Rider access is required');
  }
  await lockAssignment(tx, assignmentId);
  const assignment = await tx.deliveryAssignment.findUnique({ where: { id: assignmentId } });
  const delivery = await tx.delivery.findUnique({ where: { id: offered.deliveryId } });
  if (!assignment || assignment.riderProfileId !== rider.riderProfileId) {
    throw new NotFoundException('Offer not found');
  }
  if (assignment.idempotencyKey) {
    if (assignment.idempotencyKey !== key || assignment.payloadHash !== hash) {
      throw new ConflictException(IDEMPOTENCY_CONFLICT);
    }
    return acceptanceResult(tx, assignment, true);
  }
  if (!delivery || delivery.status !== DeliveryStatus.SEARCHING || assignment.status !== AssignmentStatus.OFFERED) {
    throw new ConflictException('This offer is no longer available');
  }
  if (!offerIsOpen(assignment.offerExpiresAt, now)) {
    throw new OfferExpiredError(delivery.id, assignment.id);
  }
  if (profile.availability !== RiderAvailability.AVAILABLE) {
    throw new ConflictException('You are not available');
  }
  const location = await tx.riderLocation.findUnique({ where: { riderProfileId: profile.id } });
  if (!location || !gpsIsFresh(location.updatedAt, now)) {
    throw new ConflictException('A fresh location is required');
  }
  const eligible = await acceptanceRider(tx, profile);
  if (!eligible) {
    throw new ConflictException('An active verified account is required');
  }
  const motorcycleId = motorcycleForAcceptance(eligible);
  const otherAccepted = await tx.deliveryAssignment.findFirst({
    where: { riderProfileId: profile.id, status: AssignmentStatus.ACCEPTED },
  });
  if (otherAccepted) {
    throw new ConflictException('You already have an accepted delivery');
  }
  const reservation = await openPlatformFeeReservation(tx, profile.id, delivery.id, now);
  await tx.deliveryAssignment.update({
    where: { id: assignment.id },
    data: {
      status: AssignmentStatus.ACCEPTED,
      motorcycleId,
      respondedAt: now,
      idempotencyKey: key,
      payloadHash: hash,
      acceptedPlatformFee: reservation.amount,
      acceptedFeeConfigVersion: reservation.configVersion,
    },
  });
  await cancelOffered(tx, { deliveryId: delivery.id });
  await cancelOffered(tx, { riderProfileId: profile.id });
  await tx.riderProfile.update({
    where: { id: profile.id },
    data: { availability: RiderAvailability.BUSY, updatedAt: now },
  });
  await tx.delivery.update({
    where: { id: delivery.id },
    data: { status: DeliveryStatus.ASSIGNED, updatedAt: now },
  });
  await recordStatus(
    tx,
    delivery.id,
    delivery.status,
    DeliveryStatus.ASSIGNED,
    rider.userId,
    DeliveryActorType.RIDER,
    now,
  );
  return {
    assignmentId: assignment.id,
    deliveryId: delivery.id,
    status: DeliveryStatus.ASSIGNED,
    availability: RiderAvailability.BUSY,
    offeredPrice: formatCents(centsFromDecimal(delivery.price)),
    currency: Currency.USD,
    reservedFee: reservation.amount,
    configVersion: reservation.configVersion,
    replayed: false,
  };
}

async function replayAcceptance(
  tx: Prisma.TransactionClient,
  rider: RiderContext,
  key: string,
  hash: string,
): Promise<AcceptanceResult> {
  const existing = await tx.deliveryAssignment.findUnique({ where: { idempotencyKey: key } });
  if (!existing || existing.riderProfileId !== rider.riderProfileId) {
    throw new ConflictException('This offer is no longer available');
  }
  if (existing.payloadHash !== hash) {
    throw new ConflictException(IDEMPOTENCY_CONFLICT);
  }
  return acceptanceResult(tx, existing, true);
}

async function releaseDelivery(
  tx: Prisma.TransactionClient,
  rider: RiderContext,
  assignmentId: string,
  reason: AssignmentReleaseReason,
  now: Date,
) {
  const existing = await tx.deliveryAssignment.findUnique({ where: { id: assignmentId } });
  if (!existing || existing.riderProfileId !== rider.riderProfileId) {
    throw new NotFoundException('Offer not found');
  }
  await lockDelivery(tx, existing.deliveryId);
  const profile = await lockRiderProfile(tx, rider.riderProfileId, 'Rider profile not found');
  if (profile.userId !== rider.userId) {
    throw new ForbiddenException('Rider access is required');
  }
  await lockAssignment(tx, assignmentId);
  const assignment = await tx.deliveryAssignment.findUnique({ where: { id: assignmentId } });
  const delivery = await tx.delivery.findUnique({ where: { id: existing.deliveryId } });
  if (!assignment || assignment.riderProfileId !== rider.riderProfileId) {
    throw new NotFoundException('Offer not found');
  }
  if (!delivery || assignment.status !== AssignmentStatus.ACCEPTED || !RELEASEABLE.has(delivery.status)) {
    throw new ConflictException('This delivery cannot be released');
  }
  await releasePlatformFeeReservation(tx, delivery.id, now);
  await tx.deliveryAssignment.update({
    where: { id: assignment.id },
    data: {
      status: AssignmentStatus.RELEASED,
      releaseReason: reason,
      releasedAt: now,
    },
  });
  await cancelOffered(tx, { deliveryId: delivery.id });
  const availability = await restoreAvailability(tx, profile, now);
  const nextGeneration = delivery.searchGeneration + 1;
  await tx.delivery.update({
    where: { id: delivery.id },
    data: { status: DeliveryStatus.SEARCHING, searchGeneration: nextGeneration, updatedAt: now },
  });
  await recordStatus(
    tx,
    delivery.id,
    delivery.status,
    DeliveryStatus.SEARCHING,
    rider.userId,
    DeliveryActorType.RIDER,
    now,
  );
  await insertRounds(tx, delivery.id, nextGeneration, now);
  return {
    deliveryId: delivery.id,
    status: DeliveryStatus.SEARCHING,
    searchGeneration: nextGeneration,
    availability,
  };
}

async function executeRound(tx: Prisma.TransactionClient, roundId: string, now: Date): Promise<void> {
  const claimed = await tx.deliveryDispatchRound.findUnique({ where: { id: roundId } });
  if (!claimed || claimed.status !== DispatchRoundStatus.PENDING) {
    return;
  }
  await lockDelivery(tx, claimed.deliveryId);
  const delivery = await tx.delivery.findUnique({ where: { id: claimed.deliveryId } });
  const round = await tx.deliveryDispatchRound.findUnique({ where: { id: roundId } });
  if (!round || round.status !== DispatchRoundStatus.PENDING) {
    return;
  }
  const active = delivery
    && delivery.status === DeliveryStatus.SEARCHING
    && delivery.searchGeneration === round.searchGeneration;
  if (active && delivery) {
    await expireOffers(tx, delivery.id, null, now);
    const candidates = await findDispatchCandidates(tx, {
      pickupLatitude: coordinateText(delivery.pickupLatitude),
      pickupLongitude: coordinateText(delivery.pickupLongitude),
      radiusMetres: round.radiusMetres,
      freshAfter: new Date(now.getTime() - GPS_FRESH_MS),
      deliveryId: delivery.id,
      searchGeneration: round.searchGeneration,
    });
    const assignments = await tx.deliveryAssignment.findMany({ where: { deliveryId: delivery.id } });
    for (const candidate of candidates) {
      if (riderIsBlocked(assignments, candidate.riderProfileId, round.searchGeneration)) {
        continue;
      }
      const offer = await offerRider(tx, delivery.id, candidate.riderProfileId, round.searchGeneration, now);
      if (offer) {
        assignments.push(offer);
      }
    }
  }
  await tx.deliveryDispatchRound.update({
    where: { id: roundId },
    data: { status: DispatchRoundStatus.COMPLETED, completedAt: now },
  });
}

async function offerRider(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  riderProfileId: string,
  searchGeneration: number,
  now: Date,
) {
  const profile = await tx.riderProfile.findUnique({ where: { id: riderProfileId } });
  if (!profile || profile.availability !== RiderAvailability.AVAILABLE) {
    return null;
  }
  const location = await tx.riderLocation.findUnique({ where: { riderProfileId } });
  if (!location || !gpsIsFresh(location.updatedAt, now)) {
    return null;
  }
  const eligible = await acceptanceRider(tx, profile);
  if (!eligible) {
    return null;
  }
  try {
    motorcycleForAcceptance(eligible);
  } catch (error) {
    if (error instanceof ConflictException) {
      return null;
    }
    throw error;
  }
  const created = await tx.deliveryAssignment.create({
    data: {
      deliveryId,
      riderProfileId,
      motorcycleId: null,
      status: AssignmentStatus.OFFERED,
      offerExpiresAt: new Date(now.getTime() + OFFER_TTL_MS),
      searchGeneration,
      createdAt: now,
      acceptedPlatformFee: null,
      acceptedFeeConfigVersion: null,
    },
  });
  return created;
}

async function acceptanceResult(
  tx: Prisma.TransactionClient,
  assignment: AssignmentRow,
  replayed: boolean,
): Promise<AcceptanceResult> {
  const delivery = await tx.delivery.findUnique({ where: { id: assignment.deliveryId } });
  if (!delivery) {
    throw new NotFoundException('Delivery not found');
  }
  if (assignment.acceptedPlatformFee == null || assignment.acceptedFeeConfigVersion == null) {
    throw new ConflictException('Platform fee reservation is corrupted');
  }
  return {
    assignmentId: assignment.id,
    deliveryId: delivery.id,
    status: DeliveryStatus.ASSIGNED,
    availability: RiderAvailability.BUSY,
    offeredPrice: formatCents(centsFromDecimal(delivery.price)),
    currency: Currency.USD,
    reservedFee: moneyText(assignment.acceptedPlatformFee),
    configVersion: assignment.acceptedFeeConfigVersion,
    replayed,
  };
}

async function acceptanceRider(
  tx: Prisma.TransactionClient,
  profile: ProfileRow,
): Promise<AcceptanceRider | null> {
  const user = await tx.user.findUnique({ where: { id: profile.userId } });
  if (!user) {
    return null;
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

async function restoreAvailability(
  tx: Prisma.TransactionClient,
  profile: ProfileRow,
  now: Date,
): Promise<RiderAvailability> {
  if (profile.availability !== RiderAvailability.BUSY) {
    return profile.availability;
  }
  const eligible = await acceptanceRider(tx, profile);
  let next: RiderAvailability = RiderAvailability.OFFLINE;
  if (eligible) {
    try {
      motorcycleForAcceptance(eligible);
      next = RiderAvailability.AVAILABLE;
    } catch (error) {
      if (!(error instanceof ConflictException)) {
        throw error;
      }
    }
  }
  await tx.riderProfile.update({
    where: { id: profile.id },
    data: { availability: next, updatedAt: now },
  });
  return next;
}

function riderIsBlocked(
  assignments: Array<{ riderProfileId: string; status: AssignmentStatus; searchGeneration: number | null }>,
  riderProfileId: string,
  generation: number,
): boolean {
  return assignments.some((row) => row.riderProfileId === riderProfileId && (
    row.status === AssignmentStatus.RELEASED
    || row.searchGeneration === generation
    || row.status === AssignmentStatus.OFFERED
    || row.status === AssignmentStatus.ACCEPTED
  ));
}

async function expireOffers(
  tx: Prisma.TransactionClient,
  deliveryId: string | null,
  riderProfileId: string | null,
  now: Date,
): Promise<void> {
  const where: { deliveryId?: string; riderProfileId?: string; status: AssignmentStatus } = {
    status: AssignmentStatus.OFFERED,
  };
  if (deliveryId) {
    where.deliveryId = deliveryId;
  }
  if (riderProfileId) {
    where.riderProfileId = riderProfileId;
  }
  const offers = await tx.deliveryAssignment.findMany({ where });
  for (const offer of offers) {
    if (!offerIsOpen(offer.offerExpiresAt, now)) {
      await tx.deliveryAssignment.update({
        where: { id: offer.id },
        data: { status: AssignmentStatus.EXPIRED },
      });
    }
  }
}

async function cancelOffered(
  tx: Prisma.TransactionClient,
  where: { deliveryId?: string; riderProfileId?: string },
): Promise<void> {
  const offers = await tx.deliveryAssignment.findMany({
    where: { ...where, status: AssignmentStatus.OFFERED },
  });
  for (const offer of offers) {
    await tx.deliveryAssignment.update({
      where: { id: offer.id },
      data: { status: AssignmentStatus.CANCELLED },
    });
  }
}

async function processAutoRetry(
  tx: Prisma.TransactionClient,
  now: Date,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT d."id"
    FROM "deliveries" d
    WHERE d."status" = 'SEARCHING'::"delivery_status"
      AND d."search_generation" > 0
      AND NOT EXISTS (
        SELECT 1
        FROM "delivery_dispatch_rounds" r
        WHERE r."delivery_id" = d."id"
          AND r."status" = 'PENDING'::"dispatch_round_status"
      )
      AND NOT EXISTS (
        SELECT 1
        FROM "delivery_assignments" a
        WHERE a."delivery_id" = d."id"
          AND a."status" = 'OFFERED'::"assignment_status"
          AND a."offer_expires_at" > ${now}
      )
      AND (
        (d."next_retry_at" IS NOT NULL AND d."next_retry_at" <= ${now})
        OR d."next_retry_at" IS NULL
      )
    ORDER BY d."updated_at" ASC
    LIMIT 1
    FOR UPDATE OF d SKIP LOCKED
  `;

  const claimed = rows[0];
  if (!claimed) {
    return false;
  }

  await expireOffers(tx, claimed.id, null, now);

  const delivery = await tx.delivery.findUnique({
    where: { id: claimed.id },
  });

  if (!delivery || delivery.status !== DeliveryStatus.SEARCHING) {
    return true;
  }

  if (delivery.nextRetryAt === null && delivery.autoRetryCount < AUTO_RETRY_MAX_COUNT) {
    await tx.delivery.update({
      where: { id: delivery.id },
      data: {
        nextRetryAt: new Date(now.getTime() + AUTO_RETRY_DELAY_MS),
        updatedAt: now,
      },
    });
    return true;
  }

  if (delivery.nextRetryAt === null && delivery.autoRetryCount >= AUTO_RETRY_MAX_COUNT) {
    await tx.delivery.update({
      where: { id: delivery.id },
      data: {
        status: DeliveryStatus.NO_RIDER_FOUND,
        nextRetryAt: null,
        updatedAt: now,
      },
    });

    await tx.deliveryStatusEvent.create({
      data: {
        deliveryId: delivery.id,
        previousStatus: DeliveryStatus.SEARCHING,
        newStatus: DeliveryStatus.NO_RIDER_FOUND,
        actorId: null,
        actorType: DeliveryActorType.SYSTEM,
        occurredAt: now,
      },
    });

    return true;
  }

  if (delivery.nextRetryAt !== null && delivery.nextRetryAt <= now) {
    const nextGeneration = delivery.searchGeneration + 1;

    await tx.delivery.update({
      where: { id: delivery.id },
      data: {
        searchGeneration: nextGeneration,
        autoRetryCount: { increment: 1 },
        nextRetryAt: null,
        searchStartedAt: now,
        updatedAt: now,
      },
    });

    await insertRounds(tx, delivery.id, nextGeneration, now);
    return true;
  }

  return true;
}

async function insertRounds(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  searchGeneration: number,
  now: Date,
): Promise<void> {
  for (let index = 0; index < DISPATCH_ROUND_RADII_METRES.length; index += 1) {
    await tx.deliveryDispatchRound.create({
      data: {
        deliveryId,
        searchGeneration,
        roundNumber: index + 1,
        radiusMetres: DISPATCH_ROUND_RADII_METRES[index],
        dueAt: new Date(now.getTime() + DISPATCH_ROUND_DELAYS_MS[index]),
        status: DispatchRoundStatus.PENDING,
        createdAt: now,
        completedAt: null,
      },
    });
  }
}

async function requiredDelivery(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  customerAccountId: string,
): Promise<DeliveryRow> {
  const delivery = await tx.delivery.findUnique({ where: { id: deliveryId } });
  if (!delivery || delivery.customerId !== customerAccountId) {
    throw new NotFoundException('Delivery not found');
  }
  return delivery;
}

async function recordStatus(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  previousStatus: DeliveryStatus,
  newStatus: DeliveryStatus,
  actorId: string,
  actorType: DeliveryActorType,
  now: Date,
): Promise<void> {
  await tx.deliveryStatusEvent.create({
    data: {
      deliveryId,
      previousStatus,
      newStatus,
      actorId,
      actorType,
      occurredAt: now,
    },
  });
}

async function lockDelivery(tx: Prisma.TransactionClient, deliveryId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT "id" FROM "deliveries" WHERE "id" = CAST(${deliveryId} AS uuid) FOR UPDATE
  `;
}

async function lockAssignment(tx: Prisma.TransactionClient, assignmentId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT "id" FROM "delivery_assignments" WHERE "id" = CAST(${assignmentId} AS uuid) FOR UPDATE
  `;
}

async function claimDueRound(tx: Prisma.TransactionClient, now: Date): Promise<{ id: string } | null> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "delivery_dispatch_rounds"
    WHERE "status" = 'PENDING'::"dispatch_round_status"
      AND "due_at" <= ${now}
    ORDER BY "due_at" ASC, "id" ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  `;
  return rows[0] ?? null;
}

function toRiderOffer(assignment: AssignmentRow, delivery: DeliveryRow): RiderOffer {
  return {
    assignmentId: assignment.id,
    deliveryId: delivery.id,
    expiresAt: assignment.offerExpiresAt.toISOString(),
    offeredPrice: formatCents(centsFromDecimal(delivery.price)),
    currency: delivery.currency,
    payer: delivery.payer,
    paymentMethod: delivery.paymentMethod,
    parcel: {
      description: delivery.parcelDescription,
      size: delivery.parcelSize,
      instructions: delivery.parcelInstructions,
    },
    pickup: {
      address: delivery.pickupAddress,
      latitude: coordinateText(delivery.pickupLatitude),
      longitude: coordinateText(delivery.pickupLongitude),
      landmark: delivery.pickupLandmark,
      instructions: delivery.pickupInstructions,
      contactName: delivery.pickupContactName,
      contactPhone: delivery.pickupContactPhone,
    },
    dropoff: {
      address: delivery.dropoffAddress,
      latitude: coordinateText(delivery.dropoffLatitude),
      longitude: coordinateText(delivery.dropoffLongitude),
      landmark: delivery.dropoffLandmark,
      instructions: delivery.dropoffInstructions,
      contactName: delivery.recipientName,
      contactPhone: delivery.recipientPhone,
    },
  };
}

function coordinateText(value: string | { toFixed(digits: number): string }): string {
  return typeof value === 'string' ? value : value.toFixed(7);
}

function moneyText(value: string | { toFixed(digits: number): string }): string {
  return typeof value === 'string' ? value : value.toFixed(2);
}

function readIdempotencyKey(value: string): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key || key.length > 200) {
    throw new BadRequestException('Enter an idempotency key');
  }
  return key;
}
















