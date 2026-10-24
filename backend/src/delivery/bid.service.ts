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
  DeliveryStatus,
  Prisma,
  ServiceClass,
} from '../generated/prisma/client.js';
import type { CustomerContext } from '../auth/customer-access.service.js';
import type { RiderContext } from '../auth/rider-access.service.js';
import { v2MarketplaceEnabled } from '../auth/v2-flags.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { centsFromDecimal, formatCents } from './money.js';
import { motorcycleForAcceptance } from '../rider/motorcycle-eligibility.js';
import { lockWalletOwner } from '../rider/wallet-lock.js';
import { closeUnassignedV2Deliveries } from './v2-deadline.js';

const MAX_BID_CENTS = 999_999_999_999;
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type StoredBid = {
  id: string;
  deliveryId: string;
  riderProfileId: string;
  amount: string | { toFixed(digits: number): string };
  currency: Currency;
  status: BidStatus;
  payloadHash: string | null;
  createdAt: Date;
};

export type PublicBid = {
  id: string;
  deliveryId: string;
  amount: string;
  amountCents: number;
  currency: Currency;
  status: BidStatus;
  createdAt: string;
  rider: { id: string; name: string };
};

@Injectable()
export class BidService {
  constructor(private readonly prisma: PrismaService) {}

  async listOwn(rider: RiderContext, query: unknown, now = new Date()) {
    this.requireMarketplace();
    const page = readBidPage(query);
    return this.prisma.$transaction(async (tx) => {
      await expireClosedBids(tx, now);
      const rows = await tx.bid.findMany({
        where: {
          riderProfileId: rider.riderProfileId,
          ...(page.cursor
            ? {
                OR: [
                  { createdAt: { lt: page.cursor.createdAt } },
                  { AND: [{ createdAt: page.cursor.createdAt }, { id: { lt: page.cursor.id } }] },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: page.limit + 1,
        include: {
          delivery: {
            select: {
              serviceClass: true,
              pickupAddress: true,
              dropoffAddress: true,
              deliverBy: true,
            },
          },
        },
      });
      const visible = rows.slice(0, page.limit);
      const last = visible[visible.length - 1];
      return {
        bids: visible.map((row) => ({
          bidId: row.id,
          deliveryId: row.deliveryId,
          amount: formatCents(centsFromDecimal(row.amount)),
          currency: row.currency,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          serviceClass: row.delivery.serviceClass,
          pickupAddress: row.delivery.pickupAddress,
          dropoffAddress: row.delivery.dropoffAddress,
          deliverBy: row.delivery.deliverBy?.toISOString() ?? null,
        })),
        nextCursor: rows.length > page.limit && last ? encodeBidCursor(last.createdAt, last.id) : null,
      };
    });
  }

  async listOpenRequests(now = new Date()) {
    this.requireMarketplace();
    return this.prisma.$transaction(async (tx) => {
      await expireClosedBids(tx, now);
      const rows = await tx.delivery.findMany({
        where: {
          status: DeliveryStatus.CREATED,
          serviceClass: { not: null },
          deliverBy: { gt: now },
          searchGeneration: 0,
        },
        orderBy: [{ deliverBy: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          serviceClass: true,
          deliverBy: true,
          currency: true,
          suggestedPrice: true,
          distanceMeters: true,
          pickupAddress: true,
          dropoffAddress: true,
          parcelDescription: true,
          parcelSize: true,
        },
      });
      return rows.map((row) => ({
        id: row.id,
        serviceClass: row.serviceClass,
        deliverBy: row.deliverBy?.toISOString() ?? null,
        currency: row.currency,
        suggestedPrice: formatCents(centsFromDecimal(row.suggestedPrice)),
        distanceMeters: row.distanceMeters,
        pickupAddress: row.pickupAddress,
        dropoffAddress: row.dropoffAddress,
        parcelDescription: row.parcelDescription,
        parcelSize: row.parcelSize,
      }));
    });
  }

  async submit(rider: RiderContext, body: unknown, idempotencyKey: string, now = new Date()): Promise<PublicBid> {
    this.requireMarketplace();
    const input = readBidSubmission(body);
    const key = readIdempotencyKey(idempotencyKey);
    const hash = bidHash(input.deliveryId, rider.riderProfileId, input.amountCents);
    await this.prisma.$transaction((tx) => expireClosedBids(tx, now, input.deliveryId));
    try {
      const outcome = await this.prisma.$transaction((tx) => this.submitLocked(tx, rider, input, key, hash, now));
      if ('closed' in outcome) {
        throw new ConflictException('The bidding window has closed');
      }
      return outcome.bid;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('This rider already has an open bid');
      }
      throw error;
    }
  }

  async withdraw(rider: RiderContext, bidId: string, now = new Date()): Promise<PublicBid> {
    this.requireMarketplace();
    if (!UUID_TEXT.test(bidId)) {
      throw new NotFoundException('Bid not found');
    }
    const outcome = await this.prisma.$transaction(async (tx) => {
      const peeked = await tx.bid.findUnique({ where: { id: bidId } });
      if (!peeked || peeked.riderProfileId !== rider.riderProfileId) {
        return { missing: true as const };
      }
      await lockDelivery(tx, peeked.deliveryId);
      await lockWalletOwner(tx, rider.riderProfileId);
      await lockBid(tx, bidId);
      await expireClosedBids(tx, now, peeked.deliveryId);
      const bid = await tx.bid.findUnique({ where: { id: bidId } });
      if (!bid || bid.riderProfileId !== rider.riderProfileId) {
        return { missing: true as const };
      }
      const name = await riderName(tx, rider.riderProfileId);
      if (bid.status === BidStatus.WITHDRAWN) {
        return { bid: toPublicBid(bid, name) };
      }
      if (bid.status !== BidStatus.OPEN) {
        return { closed: true as const };
      }
      const withdrawn = await tx.bid.update({
        where: { id: bid.id },
        data: { status: BidStatus.WITHDRAWN },
      });
      return { bid: toPublicBid(withdrawn, name) };
    });
    if ('missing' in outcome) {
      throw new NotFoundException('Bid not found');
    }
    if ('closed' in outcome) {
      throw new ConflictException('This bid is not open');
    }
    return outcome.bid;
  }

  async listForCustomer(customer: CustomerContext, deliveryId: string, now = new Date()): Promise<PublicBid[]> {
    this.requireMarketplace();
    if (!UUID_TEXT.test(deliveryId)) {
      throw new NotFoundException('Delivery not found');
    }
    return this.prisma.$transaction(async (tx) => {
      const delivery = await tx.delivery.findFirst({
        where: { id: deliveryId, customerId: customer.customerAccountId },
        select: { id: true },
      });
      if (!delivery) {
        throw new NotFoundException('Delivery not found');
      }
      await lockDelivery(tx, deliveryId);
      await expireClosedBids(tx, now, deliveryId);
      const rows = await tx.bid.findMany({
        where: { deliveryId, status: BidStatus.OPEN },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: { riderProfile: { include: { user: { select: { fullName: true } } } } },
      });
      const riderIds = [...new Set(rows.map((row) => row.riderProfileId))];
      const expressAssignments = riderIds.length === 0 ? [] : await tx.deliveryAssignment.findMany({
        where: {
          riderProfileId: { in: riderIds },
          status: AssignmentStatus.ACCEPTED,
          serviceClass: ServiceClass.EXPRESS,
        },
        select: { riderProfileId: true },
      });
      const blocked = new Set(expressAssignments.map((row) => row.riderProfileId));
      return rows
        .filter((row) => !blocked.has(row.riderProfileId))
        .map((row) => toPublicBid(row, row.riderProfile.user.fullName));
    });
  }

  private async submitLocked(
    tx: Prisma.TransactionClient,
    rider: RiderContext,
    input: { deliveryId: string; amountCents: number },
    key: string,
    hash: string,
    now: Date,
  ): Promise<{ closed: true } | { bid: PublicBid }> {
    await lockDelivery(tx, input.deliveryId);
    const delivery = await tx.delivery.findUnique({ where: { id: input.deliveryId } });
    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }
    await expireClosedBids(tx, now, delivery.id);
    if (delivery.deliverBy && delivery.deliverBy.getTime() <= now.getTime() && delivery.serviceClass) {
      return { closed: true };
    }
    if (
      delivery.status !== DeliveryStatus.CREATED
      || delivery.serviceClass == null
      || delivery.deliverBy == null
      || delivery.searchGeneration !== 0
      || delivery.currency !== Currency.USD
    ) {
      throw new ConflictException('This delivery is not open for bids');
    }
    const profile = await lockWalletOwner(tx, rider.riderProfileId);
    const user = await tx.user.findUnique({
      where: { id: profile.userId },
      select: { accountStatus: true, phoneVerifiedAt: true, fullName: true },
    });
    if (!user) {
      throw new NotFoundException('Rider profile not found');
    }
    const saved = await tx.bid.findUnique({ where: { idempotencyKey: key } });
    if (saved) {
      if (saved.riderProfileId !== rider.riderProfileId || saved.payloadHash !== hash || saved.deliveryId !== input.deliveryId) {
        throw new ConflictException('This idempotency key was already used');
      }
      return { bid: toPublicBid(saved, user.fullName) };
    }
    const motorcycles = await tx.motorcycle.findMany({
      where: { riderProfileId: profile.id },
      select: { id: true, verificationStatus: true, isActive: true },
    });
    motorcycleForAcceptance({
      accountStatus: user.accountStatus,
      phoneVerifiedAt: user.phoneVerifiedAt,
      approvalStatus: profile.approvalStatus,
      licenceVerificationStatus: profile.verificationStatus,
      motorcycles,
    });
    const open = await tx.bid.findFirst({
      where: { deliveryId: delivery.id, riderProfileId: profile.id, status: BidStatus.OPEN },
    });
    if (open) {
      throw new ConflictException('This rider already has an open bid');
    }
    const liveExpress = await tx.deliveryAssignment.findFirst({
      where: {
        riderProfileId: profile.id,
        status: AssignmentStatus.ACCEPTED,
        serviceClass: ServiceClass.EXPRESS,
      },
      select: { id: true },
    });
    if (liveExpress) {
      throw new ConflictException('You cannot submit a bid while an Express delivery is active');
    }
    const rate = await tx.v2CommissionRate.findFirst({
      where: { isActive: true },
      select: { id: true },
    });
    if (!rate) {
      throw new ConflictException('A commission percentage has not been published');
    }
    const created = await tx.bid.create({
      data: {
        deliveryId: delivery.id,
        riderProfileId: profile.id,
        amount: formatCents(input.amountCents),
        currency: Currency.USD,
        status: BidStatus.OPEN,
        idempotencyKey: key,
        payloadHash: hash,
        createdAt: now,
      },
    });
    return { bid: toPublicBid(created, user.fullName) };
  }

  private requireMarketplace() {
    if (!v2MarketplaceEnabled()) {
      throw new NotFoundException('Bidding is not available');
    }
  }
}

async function expireClosedBids(tx: Prisma.TransactionClient, now: Date, deliveryId?: string) {
  await tx.bid.updateMany({
    where: {
      status: BidStatus.OPEN,
      ...(deliveryId ? { deliveryId } : {}),
      delivery: { deliverBy: { lte: now } },
    },
    data: { status: BidStatus.EXPIRED },
  });
  await closeUnassignedV2Deliveries(tx, now, deliveryId);
}

async function riderName(tx: Prisma.TransactionClient, riderProfileId: string) {
  const profile = await tx.riderProfile.findUnique({
    where: { id: riderProfileId },
    include: { user: { select: { fullName: true } } },
  });
  return profile?.user?.fullName ?? '';
}

function toPublicBid(bid: StoredBid, name: string): PublicBid {
  const amountCents = centsFromDecimal(bid.amount);
  return {
    id: bid.id,
    deliveryId: bid.deliveryId,
    amount: formatCents(amountCents),
    amountCents,
    currency: bid.currency,
    status: bid.status,
    createdAt: bid.createdAt.toISOString(),
    rider: { id: bid.riderProfileId, name },
  };
}

const BID_PAGE_DEFAULT = 20;
const BID_PAGE_MAX = 50;

function readBidPage(query: unknown): { limit: number; cursor: { createdAt: Date; id: string } | null } {
  if (query !== undefined && (typeof query !== 'object' || query === null || Array.isArray(query))) {
    throw new BadRequestException('Enter a page size');
  }
  const record = (query ?? {}) as Record<string, unknown>;
  return { limit: readBidLimit(record.limit), cursor: readBidCursor(record.cursor) };
}

function readBidLimit(value: unknown): number {
  if (value === undefined || value === null || value === '') {
    return BID_PAGE_DEFAULT;
  }
  if (typeof value !== 'string' || !/^\d{1,2}$/.test(value)) {
    throw new BadRequestException('Enter a page size');
  }
  const limit = Number(value);
  if (limit < 1 || limit > BID_PAGE_MAX) {
    throw new BadRequestException('Enter a page size');
  }
  return limit;
}

function readBidCursor(value: unknown): { createdAt: Date; id: string } | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new BadRequestException('Enter a valid cursor');
  }
  let decoded = '';
  try {
    decoded = Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    throw new BadRequestException('Enter a valid cursor');
  }
  const split = decoded.indexOf('\n');
  if (split <= 0) {
    throw new BadRequestException('Enter a valid cursor');
  }
  const createdAt = new Date(decoded.slice(0, split));
  const id = decoded.slice(split + 1);
  if (Number.isNaN(createdAt.getTime()) || !UUID_TEXT.test(id)) {
    throw new BadRequestException('Enter a valid cursor');
  }
  return { createdAt, id };
}

function encodeBidCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}\n${id}`, 'utf8').toString('base64url');
}

function readBidSubmission(body: unknown): { deliveryId: string; amountCents: number } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Enter the bid');
  }
  const record = body as Record<string, unknown>;
  if (typeof record.deliveryId !== 'string' || !UUID_TEXT.test(record.deliveryId)) {
    throw new BadRequestException('Enter the delivery');
  }
  if (record.currency !== undefined && record.currency !== Currency.USD) {
    throw new BadRequestException('USD is the only supported currency');
  }
  if (typeof record.amountCents !== 'number' || !Number.isSafeInteger(record.amountCents) || record.amountCents < 0 || record.amountCents > MAX_BID_CENTS) {
    throw new BadRequestException('Enter the bid in cents');
  }
  return { deliveryId: record.deliveryId, amountCents: record.amountCents };
}

function readIdempotencyKey(value: string): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key || key.length > 200) {
    throw new BadRequestException('Enter an idempotency key');
  }
  return key;
}

function bidHash(deliveryId: string, riderProfileId: string, amountCents: number): string {
  return createHash('sha256').update(JSON.stringify({ deliveryId, riderProfileId, amountCents, currency: Currency.USD })).digest('hex');
}

async function lockDelivery(tx: Prisma.TransactionClient, deliveryId: string) {
  await tx.$queryRaw`SELECT "id" FROM "deliveries" WHERE "id" = CAST(${deliveryId} AS uuid) FOR UPDATE`;
}

async function lockBid(tx: Prisma.TransactionClient, bidId: string) {
  await tx.$queryRaw`SELECT "id" FROM "bids" WHERE "id" = CAST(${bidId} AS uuid) FOR UPDATE`;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'P2002';
}
