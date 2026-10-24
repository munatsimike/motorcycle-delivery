import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssignmentStatus,
  BidStatus,
  Currency,
  DeliveryActorType,
  DeliveryStatus,
  Prisma,
  RiderAvailability,
  ServiceClass,
} from '../generated/prisma/client.js';
import type { CustomerContext } from '../auth/customer-access.service.js';
import { v2MarketplaceEnabled } from '../auth/v2-flags.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { lockRiderProfile } from '../rider/motorcycle-lock.js';
import { motorcycleForAcceptance } from '../rider/motorcycle-eligibility.js';
import { assertV2CommissionCapacity, IDEMPOTENCY_CONFLICT, openV2CommissionReservation } from '../rider/wallet-ledger.js';
import { snapshotCommission } from './commission-calculator.js';
import { centsFromDecimal, formatCents } from './money.js';
import { closeUnassignedV2Deliveries } from './v2-deadline.js';
import { recordBidAccepted } from './v2-outbox.js';

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXPRESS_ASSIGNMENT_INDEX = 'delivery_assignments_one_live_express_per_rider_idx';
const V1_ASSIGNMENT_INDEX = 'delivery_assignments_one_accepted_v1_per_rider_idx';

export type BidAcceptanceResult = {
  assignmentId: string;
  deliveryId: string;
  bidId: string;
  status: DeliveryStatus;
  availability: RiderAvailability;
  acceptedBidAmount: string;
  commissionAmount: string;
  basisPoints: number;
  rateVersion: number;
  reserved: boolean;
  replayed: boolean;
};

@Injectable()
export class BidAcceptanceService {
  constructor(private readonly prisma: PrismaService) {}

  async accept(
    customer: CustomerContext,
    deliveryId: string,
    bidId: string,
    idempotencyKey: string,
    now = new Date(),
  ): Promise<BidAcceptanceResult> {
    if (!v2MarketplaceEnabled()) {
      throw new NotFoundException('Bidding is not available');
    }
    if (!UUID_TEXT.test(deliveryId) || !UUID_TEXT.test(bidId)) {
      throw new NotFoundException('Bid not found');
    }
    const key = readIdempotencyKey(idempotencyKey);
    const hash = acceptanceHash(deliveryId, bidId, customer.customerAccountId);
    await this.prisma.$transaction((tx) => expireDueBids(tx, now, deliveryId));
    try {
      return await this.prisma.$transaction((tx) => this.acceptLocked(tx, customer, deliveryId, bidId, key, hash, now));
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      return this.prisma.$transaction(async (tx) => {
        const existing = await tx.deliveryAssignment.findUnique({ where: { idempotencyKey: key } });
        if (existing && existing.payloadHash === hash) {
          return replay(tx, existing.id, true);
        }
        if (existing) {
          throw new ConflictException(IDEMPOTENCY_CONFLICT);
        }
        const constraint = uniqueConstraintName(error);
        if (constraint.includes(EXPRESS_ASSIGNMENT_INDEX)) {
          throw new ConflictException('This rider already has an Express delivery');
        }
        if (constraint.includes(V1_ASSIGNMENT_INDEX)) {
          throw new ConflictException('This rider already has an accepted delivery');
        }
        throw new ConflictException('This bid cannot be accepted');
      });
    }
  }

  private async acceptLocked(
    tx: Prisma.TransactionClient,
    customer: CustomerContext,
    deliveryId: string,
    bidId: string,
    key: string,
    hash: string,
    now: Date,
  ): Promise<BidAcceptanceResult> {
    const existingKey = await replayKey(tx, key, hash);
    if (existingKey) {
      return existingKey;
    }
    await lockDelivery(tx, deliveryId);
    const committedKey = await replayKey(tx, key, hash);
    if (committedKey) {
      return committedKey;
    }
    const delivery = await tx.delivery.findFirst({
      where: { id: deliveryId, customerId: customer.customerAccountId },
    });
    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }
    const peeked = await tx.bid.findUnique({ where: { id: bidId } });
    if (!peeked || peeked.deliveryId !== delivery.id) {
      throw new NotFoundException('Bid not found');
    }
    const profile = await lockRiderProfile(tx, peeked.riderProfileId, 'Bid not found');
    await lockBid(tx, bidId);
    const bid = await tx.bid.findUnique({ where: { id: bidId } });
    if (!bid || bid.deliveryId !== delivery.id) {
      throw new NotFoundException('Bid not found');
    }
    if (delivery.deliverBy && delivery.deliverBy.getTime() <= now.getTime()) {
      throw new ConflictException('The bidding window has closed');
    }
    if (
      delivery.status !== DeliveryStatus.CREATED
      || delivery.serviceClass == null
      || delivery.deliverBy == null
      || delivery.searchGeneration !== 0
    ) {
      throw new ConflictException('This delivery is not open for bids');
    }
    if (bid.status !== BidStatus.OPEN) {
      throw new ConflictException('This bid is not open');
    }
    const commitments = await tx.deliveryAssignment.findMany({
      where: { riderProfileId: profile.id, status: AssignmentStatus.ACCEPTED },
      select: { acceptedBidAmount: true, serviceClass: true },
    });
    if (commitments.some((row) => row.acceptedBidAmount == null)) {
      throw new ConflictException('This rider already has an accepted delivery');
    }
    if (commitments.some((row) => row.serviceClass === ServiceClass.EXPRESS)) {
      throw new ConflictException('This rider already has an Express delivery');
    }
    if (profile.availability !== RiderAvailability.AVAILABLE) {
      throw new ConflictException('This rider is not available');
    }
    if (profile.receivingRequests !== true) {
      throw new ConflictException('This rider is not receiving requests');
    }
    const user = await tx.user.findUnique({
      where: { id: profile.userId },
      select: { accountStatus: true, phoneVerifiedAt: true },
    });
    if (!user) {
      throw new NotFoundException('Bid not found');
    }
    const motorcycles = await tx.motorcycle.findMany({
      where: { riderProfileId: profile.id },
      select: { id: true, verificationStatus: true, isActive: true },
    });
    const motorcycleId = motorcycleForAcceptance({
      accountStatus: user.accountStatus,
      phoneVerifiedAt: user.phoneVerifiedAt,
      approvalStatus: profile.approvalStatus,
      licenceVerificationStatus: profile.verificationStatus,
      motorcycles,
    });
    const rates = await tx.$queryRaw<Array<{ rate_version: number; basis_points: number }>>`
      SELECT "rate_version", "basis_points"
      FROM "v2_commission_rates"
      WHERE "is_active" = true
      FOR UPDATE
    `;
    const rate = rates[0];
    if (!rate) {
      throw new ConflictException('A commission percentage has not been published');
    }
    const snapshot = snapshotCommission({
      acceptedBidCents: centsFromDecimal(bid.amount),
      basisPoints: rate.basis_points,
      rateVersion: rate.rate_version,
    });
    await assertV2CommissionCapacity(tx, profile.id, snapshot.commissionCents);
    const assignment = await tx.deliveryAssignment.create({
      data: {
        deliveryId: delivery.id,
        riderProfileId: profile.id,
        motorcycleId,
        status: AssignmentStatus.ACCEPTED,
        offerExpiresAt: delivery.deliverBy,
        respondedAt: now,
        searchGeneration: null,
        idempotencyKey: key,
        payloadHash: hash,
        acceptedPlatformFee: null,
        acceptedFeeConfigVersion: null,
        acceptedCommissionModel: null,
        acceptedCommissionPolicyVersion: null,
        serviceClass: delivery.serviceClass,
        acceptedBidAmount: formatCents(snapshot.acceptedBidCents),
        acceptedCommissionBasisPoints: snapshot.basisPoints,
        acceptedV2CommissionRateVersion: snapshot.rateVersion,
        acceptedCommissionAmount: formatCents(snapshot.commissionCents),
        acceptedBidId: bid.id,
        createdAt: now,
      },
    });
    await tx.bid.updateMany({
      where: { deliveryId: delivery.id, status: BidStatus.OPEN, id: { not: bid.id } },
      data: { status: BidStatus.SUPERSEDED },
    });
    await tx.bid.update({
      where: { id: bid.id },
      data: { status: BidStatus.ACCEPTED },
    });
    await tx.delivery.update({
      where: { id: delivery.id },
      data: {
        status: DeliveryStatus.RIDER_ASSIGNED,
        price: formatCents(snapshot.acceptedBidCents),
        updatedAt: now,
      },
    });
    await tx.deliveryStatusEvent.create({
      data: {
        deliveryId: delivery.id,
        previousStatus: delivery.status,
        newStatus: DeliveryStatus.RIDER_ASSIGNED,
        actorId: customer.userId,
        actorType: DeliveryActorType.CUSTOMER,
      },
    });
    await recordBidAccepted(tx, {
      deliveryId: delivery.id,
      assignmentId: assignment.id,
      riderProfileId: profile.id,
    });
    const reservation = await openV2CommissionReservation(
      tx,
      profile.id,
      delivery.id,
      assignment.id,
      snapshot.commissionCents,
      snapshot.rateVersion,
      now,
    );
    return {
      assignmentId: assignment.id,
      deliveryId: delivery.id,
      bidId: bid.id,
      status: DeliveryStatus.RIDER_ASSIGNED,
      availability: profile.availability,
      acceptedBidAmount: formatCents(snapshot.acceptedBidCents),
      commissionAmount: formatCents(snapshot.commissionCents),
      basisPoints: snapshot.basisPoints,
      rateVersion: snapshot.rateVersion,
      reserved: reservation.reserved,
      replayed: false,
    };
  }
}

async function replayKey(tx: Prisma.TransactionClient, key: string, hash: string): Promise<BidAcceptanceResult | null> {
  const existing = await tx.deliveryAssignment.findUnique({ where: { idempotencyKey: key } });
  if (!existing) {
    return null;
  }
  if (existing.payloadHash !== hash) {
    throw new ConflictException(IDEMPOTENCY_CONFLICT);
  }
  return replay(tx, existing.id, true);
}

async function replay(tx: Prisma.TransactionClient, assignmentId: string, replayed: boolean): Promise<BidAcceptanceResult> {
  const assignment = await tx.deliveryAssignment.findUnique({ where: { id: assignmentId } });
  if (!assignment || assignment.acceptedBidAmount == null || assignment.acceptedCommissionAmount == null || assignment.acceptedCommissionBasisPoints == null || assignment.acceptedV2CommissionRateVersion == null) {
    throw new ConflictException(IDEMPOTENCY_CONFLICT);
  }
  const bidId = assignment.acceptedBidId ?? (await tx.bid.findFirst({
    where: { deliveryId: assignment.deliveryId, riderProfileId: assignment.riderProfileId, status: BidStatus.ACCEPTED, closedAt: null },
  }))?.id ?? '';
  const reservation = await tx.walletFeeReservation.findFirst({
    where: { assignmentId: assignment.id },
  });
  const rider = await tx.riderProfile.findUnique({
    where: { id: assignment.riderProfileId },
    select: { availability: true },
  });
  if (!rider) {
    throw new ConflictException(IDEMPOTENCY_CONFLICT);
  }
  return {
    assignmentId: assignment.id,
    deliveryId: assignment.deliveryId,
    bidId,
    status: DeliveryStatus.RIDER_ASSIGNED,
    availability: rider.availability,
    acceptedBidAmount: formatCents(centsFromDecimal(assignment.acceptedBidAmount)),
    commissionAmount: formatCents(centsFromDecimal(assignment.acceptedCommissionAmount)),
    basisPoints: assignment.acceptedCommissionBasisPoints,
    rateVersion: assignment.acceptedV2CommissionRateVersion,
    reserved: reservation != null,
    replayed,
  };
}

async function expireDueBids(tx: Prisma.TransactionClient, now: Date, deliveryId: string) {
  await tx.bid.updateMany({
    where: {
      deliveryId,
      status: BidStatus.OPEN,
      delivery: { deliverBy: { lte: now } },
    },
    data: { status: BidStatus.EXPIRED },
  });
  await closeUnassignedV2Deliveries(tx, now, deliveryId);
}

async function lockDelivery(tx: Prisma.TransactionClient, deliveryId: string) {
  await tx.$queryRaw`SELECT "id" FROM "deliveries" WHERE "id" = CAST(${deliveryId} AS uuid) FOR UPDATE`;
}

async function lockBid(tx: Prisma.TransactionClient, bidId: string) {
  await tx.$queryRaw`SELECT "id" FROM "bids" WHERE "id" = CAST(${bidId} AS uuid) FOR UPDATE`;
}

function readIdempotencyKey(value: string): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key || key.length > 200) {
    throw new BadRequestException('Enter an idempotency key');
  }
  return key;
}

function acceptanceHash(deliveryId: string, bidId: string, customerAccountId: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ kind: 'v2-bid-acceptance', deliveryId, bidId, customerAccountId }))
    .digest('hex');
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'P2002';
}

function uniqueConstraintName(error: unknown): string {
  const parts: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || depth > 4) {
      return;
    }
    const record = value as { message?: unknown; meta?: { target?: unknown }; cause?: unknown };
    if (typeof record.message === 'string') {
      parts.push(record.message);
    }
    const target = record.meta?.target;
    if (typeof target === 'string') {
      parts.push(target);
    } else if (Array.isArray(target)) {
      parts.push(target.map((item) => String(item)).join(' '));
    }
    visit(record.cause, depth + 1);
  };
  visit(error, 0);
  return parts.join(' ');
}
