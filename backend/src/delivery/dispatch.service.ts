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
  BidStatus,
  CoordinateSource,
  Currency,
  DeliveryActorType,
  DeliveryStatus,
  Prisma,
  RiderAvailability,
} from '../generated/prisma/client.js';
import type { CustomerContext } from '../auth/customer-access.service.js';
import type { RiderContext } from '../auth/rider-access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { shouldWithholdCoordinates } from './coordinate-retention.js';
import { v2MarketplaceEnabled } from '../auth/v2-flags.js';
import { v2RequestRemainsOpen } from './v2-deadline.js';
import { expireDueV2Searches, restartV2Search, v2SearchStartData } from './v2-search.js';
import { lockRiderProfile } from '../rider/motorcycle-lock.js';
import {
  IDEMPOTENCY_CONFLICT,
  isUniqueViolation,
  releasePlatformFeeReservation,
  captureV2CommissionReservation,
} from '../rider/wallet-ledger.js';
import { recordRequestReopened, recordV2CustomerStatus } from './v2-outbox.js';
import { offerIsOpen } from './dispatch.constants.js';
import { centsFromDecimal, formatCents } from './money.js';
import { readCustomerOfferCents } from './delivery-request.js';

const CANCELLABLE = new Set<DeliveryStatus>([
  DeliveryStatus.CREATED,
  DeliveryStatus.SEARCHING,
  DeliveryStatus.NO_RIDER_FOUND,
]);

const V2_PRE_PICKUP = new Set<DeliveryStatus>([
  DeliveryStatus.RIDER_ASSIGNED,
  DeliveryStatus.COLLECTING,
]);

const V2_CANCEL_REASONS = new Set<AssignmentReleaseReason>([
  AssignmentReleaseReason.PAYMENT_NOT_AGREED,
  AssignmentReleaseReason.PARCEL_NOT_AS_DESCRIBED,
  AssignmentReleaseReason.PARCEL_TOO_LARGE,
  AssignmentReleaseReason.SENDER_UNAVAILABLE,
  AssignmentReleaseReason.WRONG_ADDRESS,
  AssignmentReleaseReason.BREAKDOWN,
  AssignmentReleaseReason.OTHER,
]);

export const RIDER_RESUMABLE_STATUSES = [
  DeliveryStatus.ASSIGNED,
  DeliveryStatus.ARRIVED_AT_PICKUP,
  DeliveryStatus.PICKED_UP,
  DeliveryStatus.IN_TRANSIT,
  DeliveryStatus.ARRIVED_AT_DROPOFF,
] as const;

const V2_LIVE_STATUSES = [
  DeliveryStatus.RIDER_ASSIGNED,
  DeliveryStatus.COLLECTING,
  DeliveryStatus.COLLECTED,
  DeliveryStatus.OUT_FOR_DELIVERY,
] as const;

const V2_DELIVERY_PROGRESS = [
  DeliveryStatus.RIDER_ASSIGNED,
  DeliveryStatus.COLLECTED,
  DeliveryStatus.DELIVERED,
] as const;

const LIVE_ASSIGNMENT_STATUSES = [
  ...RIDER_RESUMABLE_STATUSES,
  ...V2_LIVE_STATUSES,
] as const;

const LIVE_ASSIGNMENT_STATUS_SET = new Set<DeliveryStatus>(LIVE_ASSIGNMENT_STATUSES);

const LIVE_ASSIGNMENT_ORDER = [{ createdAt: 'asc' as const }, { id: 'asc' as const }];

type AssignmentRow = {
  id: string;
  deliveryId: string;
  riderProfileId: string;
  status: AssignmentStatus;
  offerExpiresAt: Date | null;
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
  price: string | { toFixed(digits: number): string } | null;
  currency: Currency;
  payer: string | null;
  paymentMethod: string | null;
  parcelDescription: string;
  parcelSize: string;
  parcelInstructions: string | null;
  distanceMeters: number;
  pickupAddress: string;
  pickupLatitude: string | { toFixed(digits: number): string } | null;
  pickupLongitude: string | { toFixed(digits: number): string } | null;
  pickupLandmark: string | null;
  pickupInstructions: string | null;
  pickupContactName: string;
  pickupContactPhone: string;
  dropoffAddress: string;
  dropoffLatitude: string | { toFixed(digits: number): string } | null;
  dropoffLongitude: string | { toFixed(digits: number): string } | null;
  dropoffLandmark: string | null;
  dropoffInstructions: string | null;
  recipientName: string;
  recipientPhone: string;
  createdAt?: Date;
  serviceClass?: 'EXPRESS' | 'FLEXIBLE' | null;
  deliverBy?: Date | null;
  pickupCoordinateSource?: CoordinateSource;
  pickupPlaceId?: string | null;
  pickupCoordinateRetrievedAt?: Date | null;
  pickupCoordinateRefreshAttemptedAt?: Date | null;
  dropoffCoordinateSource?: CoordinateSource;
  dropoffPlaceId?: string | null;
  dropoffCoordinateRetrievedAt?: Date | null;
  dropoffCoordinateRefreshAttemptedAt?: Date | null;
};

type ParcelView = {
  description: string;
  size: string;
  instructions: string | null;
};

type StopView = {
  address: string;
  latitude: string | null;
  longitude: string | null;
  landmark: string | null;
  instructions: string | null;
  contactName: string;
  contactPhone: string;
};

export type ActiveAssignment = {
  assignmentId: string;
  deliveryId: string;
  status: (typeof LIVE_ASSIGNMENT_STATUSES)[number];
  parcel: ParcelView;
  pickup: StopView;
  dropoff: StopView;
  serviceClass: 'EXPRESS' | 'FLEXIBLE' | null;
  deliverBy: string | null;
  agreedPrice: string | null;
  distanceMeters: number | null;
  createdAt: string | null;
};

export type CompletedAssignment = Omit<ActiveAssignment, 'status'> & {
  status: typeof DeliveryStatus.DELIVERED;
  completedAt: string;
};

type ActiveAssignmentRow = {
  id: string;
  riderProfileId: string;
  status: AssignmentStatus;
  acceptedBidAmount?: string | { toFixed(digits: number): string } | null;
  delivery: DeliveryRow;
};

export type DeliveryProgress = {
  deliveryId: string;
  status: DeliveryStatus;
  availability: RiderAvailability;
};

export type V2CancellationResult = {
  assignmentId: string;
  deliveryId: string;
  status: DeliveryStatus;
  reopened: boolean;
  released: boolean;
  availability: RiderAvailability;
  replayed: boolean;
};

@Injectable()
export class DispatchService {
  constructor(private readonly prisma: PrismaService) {}

  search(customer: CustomerContext, deliveryId: string, now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const delivery = await tx.delivery.findUnique({ where: { id: deliveryId } });
      if (!delivery || delivery.customerId !== customer.customerAccountId) {
        throw new NotFoundException('Delivery not found');
      }
      if (delivery.serviceClass !== 'EXPRESS' && delivery.serviceClass !== 'FLEXIBLE') {
        throw new ConflictException('This delivery cannot be searched');
      }
      return startSearch(tx, customer, deliveryId, now);
    });
  }

  adjustOffer(customer: CustomerContext, deliveryId: string, body: unknown, now = new Date()) {
    return this.prisma.$transaction((tx) => adjustCustomerOffer(tx, customer, deliveryId, body, now));
  }

  cancel(customer: CustomerContext, deliveryId: string, now = new Date()) {
    return this.prisma.$transaction((tx) => cancelDelivery(tx, customer, deliveryId, now));
  }

  async activeAssignment(rider: RiderContext, now = new Date()) {
    const rows = await this.prisma.deliveryAssignment.findMany({
      where: {
        riderProfileId: rider.riderProfileId,
        status: AssignmentStatus.ACCEPTED,
        delivery: { status: { in: [...LIVE_ASSIGNMENT_STATUSES] } },
      },
      include: { delivery: true },
      orderBy: LIVE_ASSIGNMENT_ORDER,
    });
    return { assignment: activeAssignmentFromRows(rider.riderProfileId, rows, now) };
  }

  async liveAssignments(rider: RiderContext, now = new Date()) {
    const rows = await this.prisma.deliveryAssignment.findMany({
      where: {
        riderProfileId: rider.riderProfileId,
        status: AssignmentStatus.ACCEPTED,
        delivery: { status: { in: [...LIVE_ASSIGNMENT_STATUSES] } },
      },
      include: { delivery: true },
      orderBy: LIVE_ASSIGNMENT_ORDER,
    });
    return {
      assignments: rows.flatMap((row) => {
        if (row.riderProfileId !== rider.riderProfileId) {
          return [];
        }
        const assignment = activeAssignmentFromRows(rider.riderProfileId, [row], now);
        return assignment ? [assignment] : [];
      }),
    };
  }

  async completedAssignments(rider: RiderContext, now = new Date()) {
    const rows = await this.prisma.deliveryAssignment.findMany({
      where: {
        riderProfileId: rider.riderProfileId,
        status: AssignmentStatus.COMPLETED,
        delivery: { status: DeliveryStatus.DELIVERED },
      },
      include: {
        delivery: {
          include: {
            statusEvents: {
              where: { newStatus: DeliveryStatus.DELIVERED },
              orderBy: { occurredAt: 'desc' },
              take: 1,
            },
          },
        },
      },
    });
    const assignments = rows.flatMap((row) => {
      const assignment = completedAssignmentFromRow(rider.riderProfileId, row, now);
      return assignment ? [assignment] : [];
    });
    assignments.sort((left, right) => {
      const byTime = right.completedAt.localeCompare(left.completedAt);
      if (byTime !== 0) {
        return byTime;
      }
      return right.assignmentId.localeCompare(left.assignmentId);
    });
    return { assignments };
  }

  async progress(
    rider: RiderContext,
    deliveryId: string,
    body: unknown,
    now = new Date(),
    idempotencyKey?: string | null,
  ) {
    const requested = readRequestedStatus(body);
    const key = normalizeProgressKey(idempotencyKey);
    const hash = key ? progressPayloadHash(deliveryId, rider.riderProfileId, requested) : null;
    try {
      return await this.prisma.$transaction((tx) => progressDelivery(tx, rider, deliveryId, requested, now, key, hash));
    } catch (error) {
      if (!key || !hash || !isUniqueViolation(error)) {
        throw error;
      }
      try {
        return await this.prisma.$transaction((tx) => replayProgressCommand(tx, rider.riderProfileId, key, hash));
      } catch (replayError) {
        if (replayError instanceof ConflictException && replayError.message === 'This delivery status cannot be changed') {
          throw error;
        }
        throw replayError;
      }
    }
  }

  async cancelBeforePickup(
    rider: RiderContext,
    assignmentId: string,
    idempotencyKey: string,
    body: unknown,
    now = new Date(),
  ): Promise<V2CancellationResult> {
    const key = readIdempotencyKey(idempotencyKey);
    const reason = readV2CancelReason(body);
    const note = readV2CancelNote(body, reason);
    const hash = cancellationHash(assignmentId, rider.riderProfileId, reason, note);
    try {
      return await this.prisma.$transaction((tx) => cancelBeforePickup(tx, rider, assignmentId, key, hash, reason, note, now));
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      return this.prisma.$transaction(async (tx) => {
        const existing = await tx.deliveryAssignment.findUnique({ where: { cancellationIdempotencyKey: key } });
        if (existing && existing.cancellationPayloadHash === hash && existing.riderProfileId === rider.riderProfileId) {
          return cancellationReplay(tx, existing.id, true);
        }
        throw new ConflictException(existing ? IDEMPOTENCY_CONFLICT : 'This delivery cannot be cancelled');
      });
    }
  }

  processV2SearchExpiry(now = new Date()): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const expired = await expireDueV2Searches(tx, now);
      return expired > 0;
    });
  }
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

function nextDeliveryStatus(status: DeliveryStatus, v2: boolean): DeliveryStatus | null {
  if (!v2) {
    return null;
  }
  if (status === DeliveryStatus.COLLECTING) {
    return DeliveryStatus.COLLECTED;
  }
  if (status === DeliveryStatus.OUT_FOR_DELIVERY) {
    return DeliveryStatus.DELIVERED;
  }
  const chain: readonly DeliveryStatus[] = V2_DELIVERY_PROGRESS;
  const index = chain.indexOf(status);
  if (index < 0 || index === chain.length - 1) {
    return null;
  }
  return chain[index + 1] ?? null;
}

function progressPayloadHash(deliveryId: string, riderProfileId: string, requested: DeliveryStatus): string {
  return createHash('sha256')
    .update(JSON.stringify({ kind: 'v2-delivery-progress', deliveryId, riderProfileId, status: requested }))
    .digest('hex');
}

function normalizeProgressKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const key = value.trim();
  if (!key) {
    return null;
  }
  if (key.length > 200) {
    throw new BadRequestException('Enter an idempotency key');
  }
  return key;
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
  key: string | null,
  hash: string | null,
): Promise<DeliveryProgress> {
  if (key && hash) {
    const prior = await tx.deliveryProgressCommand.findUnique({ where: { idempotencyKey: key } });
    if (prior) {
      return progressReplay(prior, rider.riderProfileId, hash);
    }
  }
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
  if (key && hash) {
    const prior = await tx.deliveryProgressCommand.findUnique({ where: { idempotencyKey: key } });
    if (prior) {
      return progressReplay(prior, rider.riderProfileId, hash);
    }
  }
  const v2 = assignment.acceptedBidAmount != null;
  if (v2 && (!key || !hash)) {
    throw new BadRequestException('Enter an idempotency key');
  }
  if (nextDeliveryStatus(delivery.status, v2) !== requested) {
    throw new ConflictException('This delivery status cannot be changed');
  }
  if (requested === DeliveryStatus.DELIVERED) {
    await captureV2CommissionReservation(tx, delivery.id, profile.id, assignment.id, now);
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
  const availability = profile.availability;
  if (requested === DeliveryStatus.DELIVERED) {
    await tx.deliveryAssignment.update({
      where: { id: assignment.id },
      data: { status: AssignmentStatus.COMPLETED },
    });
  }
  if (v2) {
    await recordV2CustomerStatus(tx, {
      status: requested,
      deliveryId: delivery.id,
      assignmentId: assignment.id,
      customerAccountId: delivery.customerId,
    });
  }
  if (v2 && key && hash) {
    await tx.deliveryProgressCommand.create({
      data: {
        idempotencyKey: key,
        payloadHash: hash,
        riderProfileId: rider.riderProfileId,
        deliveryId: delivery.id,
        assignmentId: assignment.id,
        requestedStatus: requested,
        resultStatus: requested,
        availability,
      },
    });
  }
  return {
    deliveryId: delivery.id,
    status: requested,
    availability,
  };
}

function progressReplay(
  prior: { payloadHash: string; riderProfileId: string; deliveryId: string; resultStatus: DeliveryStatus; availability: RiderAvailability },
  riderProfileId: string,
  hash: string,
): DeliveryProgress {
  if (prior.payloadHash !== hash || prior.riderProfileId !== riderProfileId) {
    throw new ConflictException(IDEMPOTENCY_CONFLICT);
  }
  return {
    deliveryId: prior.deliveryId,
    status: prior.resultStatus,
    availability: prior.availability,
  };
}

async function replayProgressCommand(
  tx: Prisma.TransactionClient,
  riderProfileId: string,
  key: string,
  hash: string,
): Promise<DeliveryProgress> {
  const prior = await tx.deliveryProgressCommand.findUnique({ where: { idempotencyKey: key } });
  if (!prior) {
    throw new ConflictException('This delivery status cannot be changed');
  }
  return progressReplay(prior, riderProfileId, hash);
}

async function cancelBeforePickup(
  tx: Prisma.TransactionClient,
  rider: RiderContext,
  assignmentId: string,
  key: string,
  hash: string,
  reason: AssignmentReleaseReason,
  note: string | null,
  now: Date,
): Promise<V2CancellationResult> {
  const existingKey = await tx.deliveryAssignment.findUnique({ where: { cancellationIdempotencyKey: key } });
  if (existingKey) {
    if (existingKey.cancellationPayloadHash !== hash || existingKey.riderProfileId !== rider.riderProfileId) {
      throw new ConflictException(IDEMPOTENCY_CONFLICT);
    }
    return cancellationReplay(tx, existingKey.id, true);
  }
  const peeked = await tx.deliveryAssignment.findUnique({ where: { id: assignmentId } });
  if (!peeked || peeked.riderProfileId !== rider.riderProfileId) {
    throw new NotFoundException('Delivery not found');
  }
  await lockDelivery(tx, peeked.deliveryId);
  const profile = await lockRiderProfile(tx, rider.riderProfileId, 'Rider profile not found');
  if (profile.userId !== rider.userId) {
    throw new ForbiddenException('Rider access is required');
  }
  await lockAssignment(tx, assignmentId);
  const assignment = await tx.deliveryAssignment.findUnique({ where: { id: assignmentId } });
  const delivery = await tx.delivery.findUnique({ where: { id: peeked.deliveryId } });
  if (!assignment || !delivery || assignment.riderProfileId !== rider.riderProfileId) {
    throw new NotFoundException('Delivery not found');
  }
  if (assignment.cancellationIdempotencyKey === key) {
    if (assignment.cancellationPayloadHash !== hash) {
      throw new ConflictException(IDEMPOTENCY_CONFLICT);
    }
    return cancellationReplay(tx, assignment.id, true);
  }
  if (
    assignment.status !== AssignmentStatus.ACCEPTED
    || assignment.acceptedBidAmount == null
    || assignment.acceptedCommissionAmount == null
    || !V2_PRE_PICKUP.has(delivery.status)
  ) {
    throw new ConflictException('This delivery cannot be cancelled');
  }
  const released = await releaseMatchingV2Reservation(tx, assignment, now);
  await closeAcceptedBid(tx, delivery.id, profile.id, assignment.acceptedBidId, now);
  const nextStatus = v2RequestRemainsOpen(delivery.deliverBy, now)
    ? DeliveryStatus.CREATED
    : DeliveryStatus.CANCELLED;
  await tx.deliveryAssignment.update({
    where: { id: assignment.id },
    data: {
      status: AssignmentStatus.RELEASED,
      releaseReason: reason,
      releasedAt: now,
      cancellationNote: note,
      cancellationStage: delivery.status,
      cancellationIdempotencyKey: key,
      cancellationPayloadHash: hash,
    },
  });
  const availability = profile.availability;
  await tx.delivery.update({
    where: { id: delivery.id },
    data: nextStatus === DeliveryStatus.CREATED
      ? { status: nextStatus, price: null, updatedAt: now, ...v2SearchStartData(now) }
      : { status: nextStatus, price: null, nextRetryAt: null, updatedAt: now },
  });
  await recordStatus(tx, delivery.id, delivery.status, nextStatus, rider.userId, DeliveryActorType.RIDER, now);
  if (nextStatus === DeliveryStatus.CREATED) {
    await recordRequestReopened(tx, {
      deliveryId: delivery.id,
      assignmentId: assignment.id,
      customerAccountId: delivery.customerId,
    });
  }
  return {
    assignmentId: assignment.id,
    deliveryId: delivery.id,
    status: nextStatus,
    reopened: nextStatus === DeliveryStatus.CREATED,
    released,
    availability,
    replayed: false,
  };
}

async function cancellationReplay(
  tx: Prisma.TransactionClient,
  assignmentId: string,
  replayed: boolean,
): Promise<V2CancellationResult> {
  const assignment = await tx.deliveryAssignment.findUnique({ where: { id: assignmentId } });
  if (!assignment || assignment.status !== AssignmentStatus.RELEASED) {
    throw new ConflictException(IDEMPOTENCY_CONFLICT);
  }
  const delivery = await tx.delivery.findUnique({ where: { id: assignment.deliveryId } });
  const profile = await tx.riderProfile.findUnique({ where: { id: assignment.riderProfileId } });
  const reservation = await tx.walletFeeReservation.findFirst({ where: { assignmentId: assignment.id } });
  if (!delivery || !profile || assignment.releasedAt == null) {
    throw new ConflictException(IDEMPOTENCY_CONFLICT);
  }
  const reopened = v2RequestRemainsOpen(delivery.deliverBy, assignment.releasedAt);
  return {
    assignmentId: assignment.id,
    deliveryId: delivery.id,
    status: reopened ? DeliveryStatus.CREATED : DeliveryStatus.CANCELLED,
    reopened,
    released: reservation?.status === 'RELEASED',
    availability: profile.availability,
    replayed,
  };
}

function readV2CancelReason(body: unknown): AssignmentReleaseReason {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Choose a cancellation reason');
  }
  const reason = (body as { reason?: unknown }).reason;
  if (typeof reason !== 'string' || !V2_CANCEL_REASONS.has(reason as AssignmentReleaseReason)) {
    throw new BadRequestException('Choose a cancellation reason');
  }
  return reason as AssignmentReleaseReason;
}

function readV2CancelNote(body: unknown, reason: AssignmentReleaseReason): string | null {
  const note = (body as { note?: unknown }).note;
  if (note == null || note === '') {
    if (reason === AssignmentReleaseReason.OTHER) {
      throw new BadRequestException('Enter a cancellation note');
    }
    return null;
  }
  if (typeof note !== 'string' || note.trim().length === 0 || note.trim().length > 500) {
    throw new BadRequestException('Enter a cancellation note');
  }
  return note.trim();
}

function cancellationHash(assignmentId: string, riderProfileId: string, reason: AssignmentReleaseReason, note: string | null): string {
  return createHash('sha256')
    .update(JSON.stringify({ kind: 'v2-pre-pickup-cancel', assignmentId, riderProfileId, reason, note }))
    .digest('hex');
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
  if (delivery.serviceClass !== 'EXPRESS' && delivery.serviceClass !== 'FLEXIBLE') {
    throw new ConflictException('This delivery cannot be searched');
  }
  if (!v2MarketplaceEnabled()) {
    throw new ConflictException('This delivery cannot be searched');
  }
  return restartV2Search(tx, delivery, customer.userId, now);
}

async function adjustCustomerOffer(
  tx: Prisma.TransactionClient,
  customer: CustomerContext,
  deliveryId: string,
  body: unknown,
  now: Date,
) {
  await lockDelivery(tx, deliveryId);
  const delivery = await requiredDelivery(tx, deliveryId, customer.customerAccountId);
  if (
    delivery.status !== DeliveryStatus.NO_RIDER_FOUND
    || (delivery.serviceClass !== 'EXPRESS' && delivery.serviceClass !== 'FLEXIBLE')
    || !v2RequestRemainsOpen(delivery.deliverBy ?? null, now)
    || !v2MarketplaceEnabled()
  ) {
    throw new ConflictException('This offer cannot be changed');
  }
  const accepted = await tx.deliveryAssignment.findFirst({
    where: { deliveryId: delivery.id, status: AssignmentStatus.ACCEPTED },
  });
  if (accepted) {
    throw new ConflictException('This offer cannot be changed');
  }
  const customerOffer = formatCents(readCustomerOfferCents(offeredPriceOf(body)));
  await tx.delivery.update({
    where: { id: delivery.id },
    data: { customerOffer },
  });
  return { customerOffer };
}

function offeredPriceOf(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Enter an offered price');
  }
  return (body as { offeredPrice?: unknown }).offeredPrice;
}

async function releaseMatchingV2Reservation(
  tx: Prisma.TransactionClient,
  assignment: { id: string; deliveryId: string; acceptedCommissionAmount: { toFixed(digits: number): string } | string | null },
  now: Date,
): Promise<boolean> {
  if (assignment.acceptedCommissionAmount == null) {
    throw new ConflictException('This commission reservation does not match the accepted bid');
  }
  const commissionCents = centsFromDecimal(assignment.acceptedCommissionAmount);
  const reservation = await tx.walletFeeReservation.findFirst({
    where: { assignmentId: assignment.id, status: 'OPEN' },
  });
  if (commissionCents > 0) {
    if (!reservation || centsFromDecimal(reservation.amount) !== commissionCents) {
      throw new ConflictException('This commission reservation does not match the accepted bid');
    }
  } else if (reservation) {
    throw new ConflictException('This commission reservation does not match the accepted bid');
  }
  if (reservation) {
    await releasePlatformFeeReservation(tx, assignment.deliveryId, now);
  }
  return reservation != null;
}

async function closeAcceptedBid(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  riderProfileId: string,
  acceptedBidId: string | null,
  now: Date,
): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "bids" WHERE "delivery_id" = CAST(${deliveryId} AS uuid) AND "rider_profile_id" = CAST(${riderProfileId} AS uuid) AND "status" = 'ACCEPTED'::"bid_status" FOR UPDATE`;
  const bid = await tx.bid.findFirst({
    where: acceptedBidId
      ? { id: acceptedBidId, deliveryId, status: BidStatus.ACCEPTED, closedAt: null }
      : { deliveryId, riderProfileId, status: BidStatus.ACCEPTED, closedAt: null },
  });
  if (!bid) {
    throw new ConflictException('This delivery cannot be cancelled');
  }
  await tx.bid.update({
    where: { id: bid.id },
    data: { closedAt: now },
  });
}

async function cancelV2DeliveryByCustomer(
  tx: Prisma.TransactionClient,
  customer: CustomerContext,
  assignmentId: string,
  now: Date,
) {
  const peeked = await tx.deliveryAssignment.findUnique({ where: { id: assignmentId } });
  if (!peeked) {
    throw new ConflictException('This delivery cannot be cancelled');
  }
  const profile = await lockRiderProfile(tx, peeked.riderProfileId, 'Rider profile not found');
  await lockAssignment(tx, peeked.id);
  const assignment = await tx.deliveryAssignment.findUnique({ where: { id: peeked.id } });
  const delivery = await tx.delivery.findUnique({ where: { id: peeked.deliveryId } });
  if (
    !assignment
    || !delivery
    || delivery.customerId !== customer.customerAccountId
    || assignment.status !== AssignmentStatus.ACCEPTED
    || assignment.acceptedBidAmount == null
    || assignment.acceptedCommissionAmount == null
    || !V2_PRE_PICKUP.has(delivery.status)
  ) {
    throw new ConflictException('This delivery cannot be cancelled');
  }
  await releaseMatchingV2Reservation(tx, assignment, now);
  await closeAcceptedBid(tx, delivery.id, profile.id, assignment.acceptedBidId, now);
  await tx.deliveryAssignment.update({
    where: { id: assignment.id },
    data: {
      status: AssignmentStatus.RELEASED,
      releaseReason: AssignmentReleaseReason.CUSTOMER_CANCELLED,
      releasedAt: now,
      cancellationStage: delivery.status,
    },
  });
  await tx.delivery.update({
    where: { id: delivery.id },
    data: { status: DeliveryStatus.CANCELLED, updatedAt: now },
  });
  await recordStatus(tx, delivery.id, delivery.status, DeliveryStatus.CANCELLED, customer.userId, DeliveryActorType.CUSTOMER, now);
  return { deliveryId: delivery.id, status: DeliveryStatus.CANCELLED };
}

async function cancelDelivery(
  tx: Prisma.TransactionClient,
  customer: CustomerContext,
  deliveryId: string,
  now: Date,
) {
  await lockDelivery(tx, deliveryId);
  const delivery = await requiredDelivery(tx, deliveryId, customer.customerAccountId);
  const committed = await tx.deliveryAssignment.findFirst({
    where: { deliveryId: delivery.id, status: AssignmentStatus.ACCEPTED },
  });
  if (committed?.acceptedBidAmount != null) {
    return cancelV2DeliveryByCustomer(tx, customer, committed.id, now);
  }
  if (!CANCELLABLE.has(delivery.status)) {
    throw new ConflictException('This delivery cannot be cancelled');
  }
  await expireOffers(tx, delivery.id, null, now);
  await cancelOffered(tx, { deliveryId: delivery.id });
  await tx.bid.updateMany({
    where: { deliveryId: delivery.id, status: BidStatus.OPEN },
    data: { status: BidStatus.EXPIRED },
  });
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

function marketplaceServiceClass(
  serviceClass: string | null | undefined,
  acceptedBidAmount: unknown,
): 'EXPRESS' | 'FLEXIBLE' | null {
  if (acceptedBidAmount == null) {
    return null;
  }
  if (serviceClass === 'EXPRESS' || serviceClass === 'FLEXIBLE') {
    return serviceClass;
  }
  return null;
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
    if (offer.offerExpiresAt != null && !offerIsOpen(offer.offerExpiresAt, now)) {
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

export function activeAssignmentFromRows(
  riderProfileId: string,
  rows: ActiveAssignmentRow[],
  now: Date,
): ActiveAssignment | null {
  const match = rows.find((row) =>
    row.riderProfileId === riderProfileId
    && row.status === AssignmentStatus.ACCEPTED
    && LIVE_ASSIGNMENT_STATUS_SET.has(row.delivery.status),
  );
  if (!match) {
    return null;
  }
  const stops = riderStops(match.delivery, now);
  const serviceClass = marketplaceServiceClass(match.delivery.serviceClass, match.acceptedBidAmount);
  return {
    assignmentId: match.id,
    deliveryId: match.delivery.id,
    status: match.delivery.status as ActiveAssignment['status'],
    parcel: stops.parcel,
    pickup: stops.pickup,
    dropoff: stops.dropoff,
    serviceClass,
    deliverBy: match.delivery.deliverBy instanceof Date ? match.delivery.deliverBy.toISOString() : null,
    agreedPrice: match.acceptedBidAmount == null ? null : moneyText(match.acceptedBidAmount),
    distanceMeters: typeof match.delivery.distanceMeters === 'number' ? match.delivery.distanceMeters : null,
    createdAt: match.delivery.createdAt instanceof Date ? match.delivery.createdAt.toISOString() : null,
  };
}

export function completedAssignmentFromRow(
  riderProfileId: string,
  row: ActiveAssignmentRow & {
    delivery: DeliveryRow & {
      updatedAt?: Date;
      statusEvents?: Array<{ newStatus: DeliveryStatus; occurredAt: Date }>;
    };
  },
  now: Date,
): CompletedAssignment | null {
  if (
    row.riderProfileId !== riderProfileId
    || row.status !== AssignmentStatus.COMPLETED
    || row.delivery.status !== DeliveryStatus.DELIVERED
  ) {
    return null;
  }
  const stops = riderStops(row.delivery, now);
  const serviceClass = marketplaceServiceClass(row.delivery.serviceClass, row.acceptedBidAmount);
  const delivered = row.delivery.statusEvents?.find((event) => event.newStatus === DeliveryStatus.DELIVERED);
  const completedAt = delivered?.occurredAt ?? row.delivery.updatedAt ?? row.delivery.createdAt ?? now;
  return {
    assignmentId: row.id,
    deliveryId: row.delivery.id,
    status: DeliveryStatus.DELIVERED,
    parcel: stops.parcel,
    pickup: stops.pickup,
    dropoff: stops.dropoff,
    serviceClass,
    deliverBy: row.delivery.deliverBy instanceof Date ? row.delivery.deliverBy.toISOString() : null,
    agreedPrice: row.acceptedBidAmount == null ? null : moneyText(row.acceptedBidAmount),
    distanceMeters: typeof row.delivery.distanceMeters === 'number' ? row.delivery.distanceMeters : null,
    createdAt: row.delivery.createdAt instanceof Date ? row.delivery.createdAt.toISOString() : null,
    completedAt: completedAt.toISOString(),
  };
}

function riderStops(delivery: DeliveryRow, now: Date) {
  return {
    parcel: {
      description: delivery.parcelDescription,
      size: delivery.parcelSize,
      instructions: delivery.parcelInstructions,
    },
    pickup: {
      address: delivery.pickupAddress,
      latitude: servableCoordinate(delivery, 'pickup', delivery.pickupLatitude, now),
      longitude: servableCoordinate(delivery, 'pickup', delivery.pickupLongitude, now),
      landmark: delivery.pickupLandmark,
      instructions: delivery.pickupInstructions,
      contactName: delivery.pickupContactName,
      contactPhone: delivery.pickupContactPhone,
    },
    dropoff: {
      address: delivery.dropoffAddress,
      latitude: servableCoordinate(delivery, 'dropoff', delivery.dropoffLatitude, now),
      longitude: servableCoordinate(delivery, 'dropoff', delivery.dropoffLongitude, now),
      landmark: delivery.dropoffLandmark,
      instructions: delivery.dropoffInstructions,
      contactName: delivery.recipientName,
      contactPhone: delivery.recipientPhone,
    },
  };
}

function servableCoordinate(
  delivery: DeliveryRow & { status: DeliveryStatus; createdAt?: Date },
  side: 'pickup' | 'dropoff',
  value: string | { toFixed(digits: number): string } | null,
  now = new Date(),
): string | null {
  const text = coordinateText(value);
  const withheld = shouldWithholdCoordinates(
    delivery.status,
    delivery.createdAt,
    side === 'pickup'
      ? {
        source: delivery.pickupCoordinateSource,
        placeId: delivery.pickupPlaceId,
        latitude: coordinateText(delivery.pickupLatitude),
        longitude: coordinateText(delivery.pickupLongitude),
        retrievedAt: delivery.pickupCoordinateRetrievedAt,
        refreshAttemptedAt: delivery.pickupCoordinateRefreshAttemptedAt,
      }
      : {
        source: delivery.dropoffCoordinateSource,
        placeId: delivery.dropoffPlaceId,
        latitude: coordinateText(delivery.dropoffLatitude),
        longitude: coordinateText(delivery.dropoffLongitude),
        retrievedAt: delivery.dropoffCoordinateRetrievedAt,
        refreshAttemptedAt: delivery.dropoffCoordinateRefreshAttemptedAt,
      },
    now,
  );
  return withheld ? null : text;
}

function coordinateText(value: string | { toFixed(digits: number): string } | null): string | null {
  if (value == null) {
    return null;
  }
  return typeof value === 'string' ? value : value.toFixed(7);
}

function moneyText(value: string | { toFixed(digits: number): string }): string {
  return typeof value === 'string' ? value : value.toFixed(2);
}

function agreedPriceCents(price: string | { toFixed(digits: number): string } | null): number {
  if (price == null) {
    throw new ConflictException('This delivery has no agreed price');
  }
  return centsFromDecimal(price);
}

function readIdempotencyKey(value: string): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key || key.length > 200) {
    throw new BadRequestException('Enter an idempotency key');
  }
  return key;
}

