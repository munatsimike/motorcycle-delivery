import { exactPageKeys, orderedPageRows } from '../common/exact-page.js';
import { encodeListCursor, readListCursor } from '../common/list-cursor.js';
import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import {
  AssignmentStatus,
  BidStatus,
  Currency,
  DeliveryActorType,
  DeliveryStatus,
  DeliveryType,
  PricingModel,
  PricingWindowKind,
  ProfilePhotoStatus,
  ServiceClass,
  UserRole,
} from '../generated/prisma/client.js';
import type { CustomerContext } from '../auth/customer-access.service.js';
import { v2MarketplaceEnabled } from '../auth/v2-flags.js';
import { recordDeliveryOpportunity } from './v2-outbox.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { readDeliveryDraft, readQuoteRequest, readV2DeliveryDraft, type QuotePins, type QuoteRequest, type V2DeliveryDraft } from './delivery-request.js';
import { assignedRiderStatus, customerCancellationView, customerRoutesToDropoff, customerSharesRiderLocation, freshRiderPoint, toCustomerDelivery, toCustomerDeliverySummary, withAssignedRider, withCollectingRiderLocation, withCustomerCancellation, withCustomerRating, withPickupApproach, type AssignedRiderView, type PickupApproachView, type RiderPoint, type StoredDelivery } from './delivery-view.js';
import { PICKUP_APPROACH, type PickupApproachLookup } from './pickup-approach.js';
import { centsFromDecimal, formatCents, roundSuggestedCents } from './money.js';
import { lockActiveClassPricing } from './pricing-lock.js';
import { calculateTariffPrice, PricingCalculationError, type TariffSnapshot } from './pricing-calculator.js';
import { ROAD_DISTANCE, geoapifyRoadDistance, type RoadDistance } from './geoapify.js';
import { V2_SEARCH_WINDOW_MS } from './v2-search.js';
import { IDEMPOTENCY_CONFLICT } from '../rider/wallet-ledger.js';
import { assertZwgOffersOpen, readActiveExchangeRate, suggestedCentsForCurrency } from './exchange-rate.js';

export const PRICING_CLOCK = Symbol('PRICING_CLOCK');

@Injectable()
export class DeliveryService {
  private readonly roads: RoadDistance;
  private readonly clock: () => Date;
  private readonly pickupApproach: PickupApproachLookup;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(ROAD_DISTANCE) roads?: RoadDistance,
    @Optional() @Inject(PRICING_CLOCK) clock?: () => Date,
    @Optional() @Inject(PICKUP_APPROACH) pickupApproach?: PickupApproachLookup,
  ) {
    this.roads = roads ?? geoapifyRoadDistance();
    this.clock = clock ?? (() => new Date());
    this.pickupApproach = pickupApproach ?? { lookup: async () => null };
  }

  async getById(customer: CustomerContext, deliveryId: string) {
    if (customer.role !== UserRole.CUSTOMER) {
      const owned = await this.prisma.customerAccount.findFirst({
        where: { id: customer.customerAccountId, userId: customer.userId },
        select: { id: true },
      });
      if (!owned) {
        throw new ForbiddenException('Customer access is required');
      }
    }
    const delivery = await this.prisma.delivery.findFirst({
      where: {
        id: deliveryId,
        customerId: customer.customerAccountId,
      },
      include: {
        statusEvents: {
          where: { newStatus: DeliveryStatus.DELIVERED },
          orderBy: { occurredAt: 'desc' },
          take: 1,
          select: { newStatus: true, occurredAt: true },
        },
      },
    });

    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }

    const view = toCustomerDelivery(delivery);
    const point = customerSharesRiderLocation(delivery.status)
      ? await this.collectingRiderPoint(delivery.id)
      : null;
    const rider = assignedRiderStatus(delivery.status) ? await this.assignedRider(delivery.id) : null;
    const destination = customerRoutesToDropoff(delivery.status) ? view.dropoff : view.pickup;
    const approach = await this.pickupApproachFor(point, destination.latitude, destination.longitude);
    const rating = await this.customerRating(delivery.id, delivery.status, rider != null);
    const rated = withCustomerRating(
      withAssignedRider(withPickupApproach(withCollectingRiderLocation(view, point), approach), rider),
      rating,
    );
    if (delivery.status !== DeliveryStatus.CANCELLED) {
      return rated;
    }
    return withCustomerCancellation(rated, await this.customerCancellation(delivery.id));
  }

  private async customerCancellation(deliveryId: string) {
    const assignments = this.prisma.deliveryAssignment;
    if (!assignments || typeof assignments.findFirst !== 'function') {
      return null;
    }
    const assignment = await assignments.findFirst({
      where: { deliveryId, status: AssignmentStatus.RELEASED },
      orderBy: { releasedAt: 'desc' },
      select: { releaseReason: true, cancellationStage: true },
    });
    const events = this.prisma.deliveryStatusEvent;
    const event = events && typeof events.findFirst === 'function'
      ? await events.findFirst({
        where: { deliveryId, newStatus: DeliveryStatus.CANCELLED },
        orderBy: { occurredAt: 'desc' },
        select: { actorType: true },
      })
      : null;
    return customerCancellationView({
      actorType: event?.actorType ?? null,
      releaseReason: assignment?.releaseReason ?? null,
      cancellationStage: assignment?.cancellationStage ?? null,
    });
  }

  private async customerRating(
    deliveryId: string,
    status: DeliveryStatus,
    hasAssignedRider: boolean,
  ) {
    const stored = this.prisma.riderRating
      ? await this.prisma.riderRating.findUnique({ where: { deliveryId }, select: { stars: true } })
      : null;
    if (stored) {
      return { eligible: false, submitted: true, stars: stored.stars };
    }
    return {
      eligible: status === DeliveryStatus.DELIVERED && hasAssignedRider,
      submitted: false,
      stars: null,
    };
  }

  private async pickupApproachFor(
    point: RiderPoint | null,
    pickupLatitude: string | null,
    pickupLongitude: string | null,
  ): Promise<PickupApproachView | null> {
    const riderProfileId = point?.riderProfileId;
    const riderLatitude = coordinateNumber(point?.latitude);
    const riderLongitude = coordinateNumber(point?.longitude);
    const pickupLat = coordinateNumber(pickupLatitude);
    const pickupLng = coordinateNumber(pickupLongitude);
    if (!riderProfileId || riderLatitude === null || riderLongitude === null || pickupLat === null || pickupLng === null) {
      return null;
    }
    try {
      return await this.pickupApproach.lookup({
        riderProfileId,
        riderLatitude,
        riderLongitude,
        pickupLatitude: pickupLat,
        pickupLongitude: pickupLng,
      });
    } catch {
      return null;
    }
  }

  private async collectingRiderPoint(deliveryId: string): Promise<RiderPoint | null> {
    const assignment = await this.prisma.deliveryAssignment.findFirst({
      where: {
        deliveryId,
        status: AssignmentStatus.ACCEPTED,
        acceptedBidAmount: { not: null },
      },
      select: { riderProfileId: true },
    });
    if (!assignment) {
      return null;
    }
    const location = await this.prisma.riderLocation.findUnique({
      where: { riderProfileId: assignment.riderProfileId },
      select: { latitude: true, longitude: true, updatedAt: true },
    });
    if (!location) {
      return null;
    }
    const fresh = freshRiderPoint({
      latitude: pointText(location.latitude),
      longitude: pointText(location.longitude),
    }, location.updatedAt, new Date());
    if (!fresh) {
      return null;
    }
    return {
      ...fresh,
      updatedAt: location.updatedAt.toISOString(),
      riderProfileId: assignment.riderProfileId,
    };
  }

  /** Fresh coordinates for the list. The PWA decides arrival with the existing 50-metre check. */
  private async listDropoffFixes(rows: Array<{ id: string; status: DeliveryStatus }>) {
    const fixes = new Map<string, { latitude: number; longitude: number; updatedAt: string }>();
    const ids = rows.filter((row) => customerRoutesToDropoff(row.status)).map((row) => row.id);
    const db = this.prisma as unknown as {
      deliveryAssignment?: {
        findMany: (args: {
          where: { deliveryId: { in: string[] }; status: AssignmentStatus };
          select: { deliveryId: true; riderProfileId: true };
        }) => Promise<Array<{ deliveryId: string; riderProfileId: string }>>;
      };
      riderLocation?: {
        findMany: (args: {
          where: { riderProfileId: { in: string[] } };
          select: { riderProfileId: true; latitude: true; longitude: true; updatedAt: true };
        }) => Promise<Array<{
          riderProfileId: string;
          latitude: string | { toFixed(digits: number): string };
          longitude: string | { toFixed(digits: number): string };
          updatedAt: Date;
        }>>;
      };
    };
    if (ids.length === 0 || !db.deliveryAssignment?.findMany || !db.riderLocation?.findMany) {
      return fixes;
    }
    const assignments = await db.deliveryAssignment.findMany({
      where: { deliveryId: { in: ids }, status: AssignmentStatus.ACCEPTED },
      select: { deliveryId: true, riderProfileId: true },
    });
    if (assignments.length === 0) {
      return fixes;
    }
    const locations = await db.riderLocation.findMany({
      where: { riderProfileId: { in: assignments.map((item) => item.riderProfileId) } },
      select: { riderProfileId: true, latitude: true, longitude: true, updatedAt: true },
    });
    const byRider = new Map(locations.map((item) => [item.riderProfileId, item]));
    for (const assignment of assignments) {
      const location = byRider.get(assignment.riderProfileId);
      if (!location) continue;
      const latitude = coordinateNumber(pointText(location.latitude));
      const longitude = coordinateNumber(pointText(location.longitude));
      if (latitude === null || longitude === null) continue;
      fixes.set(assignment.deliveryId, {
        latitude,
        longitude,
        updatedAt: location.updatedAt.toISOString(),
      });
    }
    return fixes;
  }

  private async assignedRider(deliveryId: string): Promise<AssignedRiderView | null> {
    const assignment = await this.prisma.deliveryAssignment.findFirst({
      where: { deliveryId, status: { in: [AssignmentStatus.ACCEPTED, AssignmentStatus.COMPLETED] } },
      orderBy: { createdAt: 'desc' },
      select: {
        riderProfile: {
          select: {
            id: true,
            verificationStatus: true,
            user: { select: { fullName: true, phone: true } },
            motorcycles: {
              where: { isActive: true, verificationStatus: 'VERIFIED', removedAt: null },
              select: { make: true, model: true, registrationNumber: true, colour: true },
              take: 1,
            },
          },
        },
      },
    });
    const profile = assignment?.riderProfile;
    const name = profile?.user.fullName?.trim() ?? '';
    if (!profile || !name) {
      return null;
    }
    const bike = profile.motorcycles[0];
    const motorcycle = [bike?.make, bike?.model].map((part) => part?.trim() ?? '').filter((part) => part.length > 0).join(' ');
    const registrationNumber = bike?.registrationNumber?.trim() ?? '';
    const colour = bike?.colour?.trim() ?? '';
    const phone = profile.user.phone?.trim() ?? '';
    const photo = await this.prisma.riderProfilePhoto.findFirst({
      where: { riderProfileId: profile.id, status: ProfilePhotoStatus.STORED },
      select: { id: true },
    });
    return {
      name,
      verified: profile.verificationStatus === 'VERIFIED',
      motorcycle: motorcycle || null,
      registrationNumber: registrationNumber || null,
      colour: colour || null,
      phone: phone || null,
      hasProfilePhoto: photo !== null,
    };
  }

  async list(customer: CustomerContext, query: Record<string, unknown>) {
    const page = readPage(query.page, 1, 1, 100_000);
    const limit = readPage(query.limit, 20, 1, 100);
    const statuses = readStatuses(query.status);
    const where = {
      customerId: customer.customerAccountId,
      ...(statuses ? { status: { in: statuses } } : {}),
    };
    const cursorMode = query.pagination === 'cursor';
    const cursorPage = cursorMode ? readListCursor(query.limit, query.cursor) : null;
    const selection = {
          id: true,
          status: true,
          createdAt: true,
          pickupAddress: true,
          dropoffAddress: true,
          serviceClass: true,
          deliverBy: true,
          offerResponseExpiresAt: true,
          currency: true,
          suggestedPrice: true,
          price: true,
          distanceMeters: true,
          dropoffLatitude: true,
          dropoffLongitude: true,
        } as const;
    const keys = cursorPage ? await exactPageKeys(this.prisma, 'deliveries', customer.customerAccountId, cursorPage.limit, cursorPage.cursor, statuses) : null;
    const visibleKeys = keys?.slice(0, cursorPage!.limit);
    const args = {
      where: visibleKeys ? { ...where, id: { in: visibleKeys.map(key => key.id) } } : where,
      orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
      select: selection,
    };
    const [total, fetched] = cursorPage
      ? [0, await this.prisma.delivery.findMany({ ...args, take: cursorPage.limit })] as const
      : await this.prisma.$transaction([this.prisma.delivery.count({ where }),
          this.prisma.delivery.findMany({ ...args, skip: (page - 1) * limit, take: limit })]);
    const rows = visibleKeys ? orderedPageRows(visibleKeys, fetched) : fetched;
    const lastKey = visibleKeys?.[visibleKeys.length - 1];
    const openBidCount = await countOpenBids(this.prisma, rows, new Date());
    const riderFixes = await this.listDropoffFixes(rows);
    return {
      data: rows.map((delivery) => {
        const summary = toCustomerDeliverySummary(delivery, openBidCount.get(delivery.id) ?? 0);
        const fix = riderFixes.get(delivery.id);
        const dropoffLatitude = coordinateNumber(pointTextOrNull(delivery.dropoffLatitude));
        const dropoffLongitude = coordinateNumber(pointTextOrNull(delivery.dropoffLongitude));
        if (!fix || dropoffLatitude === null || dropoffLongitude === null) return summary;
        return { ...summary, dropoffLatitude, dropoffLongitude, riderLocation: fix };
      }),
      pagination: cursorPage ? { limit: cursorPage.limit, nextCursor: keys && keys.length > cursorPage.limit && lastKey ? encodeListCursor(lastKey.at, lastKey.id) : null } : { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async quote(body: unknown) {
    const request = readQuoteRequest(body);
    if (!v2MarketplaceEnabled()) {
      throw new NotFoundException('Bidding is not available');
    }
    assertZwgOffersOpen(request.currency);
    return this.quoteServiceClass(request);
  }

  async create(customer: CustomerContext, body: unknown, idempotencyKey?: string) {
    if (!v2MarketplaceEnabled()) {
      readDeliveryDraft(body);
      throw new NotFoundException('Bidding is not available');
    }
    return this.createV2Request(customer, body, readIdempotencyKey(idempotencyKey));
  }

  private async createV2Request(customer: CustomerContext, body: unknown, key: string) {
    const now = this.clock();
    const draft = readV2DeliveryDraft(body, now);
    const hash = creationHash(customer.customerAccountId, draft);
    const replayed = await this.replayCreate(this.prisma, key, hash, customer.customerAccountId);
    if (replayed) {
      return replayed;
    }
    assertZwgOffersOpen(draft.currency);
    const metres = await this.roadMetres(draft);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const raced = await this.replayCreate(tx, key, hash, customer.customerAccountId);
        if (raced) {
          return raced;
        }
        assertZwgOffersOpen(draft.currency);
        const cooldown = await tx.$queryRaw<Array<{ deadline: Date | null }>>`SELECT route_cooldown_until(CAST(${customer.customerAccountId} AS uuid), CAST(${draft.pickupLatitude} AS double precision), CAST(${draft.pickupLongitude} AS double precision), CAST(${draft.dropoffLatitude} AS double precision), CAST(${draft.dropoffLongitude} AS double precision)) AS deadline`;
        if (cooldown?.[0]?.deadline) throw new ConflictException(`ROUTE_COOLDOWN_UNTIL ${cooldown[0].deadline.toISOString()}`);
        await lockActiveClassPricing(tx, draft.serviceClass);
        const active = await tx.deliveryPricingConfig.findFirst({
          where: { isActive: true, serviceClass: draft.serviceClass },
          include: {
            tiers: { orderBy: { position: 'asc' } },
            windows: true,
          },
        });
        if (!active) {
          throw classPricingUnavailable(draft.serviceClass);
        }
        let priced;
        try {
          priced = calculateTariffPrice(toClassSnapshot(active), metres, now);
        } catch (error) {
          throw quotedPriceError(error);
        }
        const rate = await readActiveExchangeRate(tx);
        const suggestedCents = roundSuggestedCents(suggestedCentsForCurrency(priced.suggestedPriceCents, draft.currency, rate));
        const retrievedAt = new Date();
        const created = await tx.delivery.create({
          data: {
            customerId: customer.customerAccountId,
            deliveryType: DeliveryType.PARCEL,
            pickupAddress: draft.pickupAddress,
            pickupLatitude: draft.pickupLatitude,
            pickupLongitude: draft.pickupLongitude,
            pickupPlaceId: draft.pickupPlaceId,
            pickupCoordinateSource: draft.pickupCoordinateSource,
            pickupCoordinateRetrievedAt: retrievedAt,
            pickupLandmark: draft.pickupLandmark,
            pickupInstructions: draft.pickupInstructions,
            pickupContactName: draft.pickupContactName,
            pickupContactPhone: draft.pickupContactPhone,
            dropoffAddress: draft.dropoffAddress,
            dropoffLatitude: draft.dropoffLatitude,
            dropoffLongitude: draft.dropoffLongitude,
            dropoffPlaceId: draft.dropoffPlaceId,
            dropoffCoordinateSource: draft.dropoffCoordinateSource,
            dropoffCoordinateRetrievedAt: retrievedAt,
            dropoffLandmark: draft.dropoffLandmark,
            dropoffInstructions: draft.dropoffInstructions,
            parcelDescription: draft.parcelDescription,
            parcelSize: draft.parcelSize,
            parcelInstructions: draft.parcelInstructions,
            recipientName: draft.dropoffContactName,
            recipientPhone: draft.dropoffContactPhone,
            price: null,
            suggestedPrice: formatCents(suggestedCents),
            customerOffer: formatCents(draft.offeredPriceCents),
            distanceMeters: priced.distanceMetres,
            pricingVersion: priced.pricingVersion,
            pricingModel: priced.pricingModel,
            pricingBasisPoints: priced.basisPoints,
            pricingWindowId: priced.pricingWindow?.id ?? null,
            payer: null,
            currency: draft.currency,
            exchangeRateVersion: rate?.rateVersion ?? null,
            exchangeRateZigPerUsd: rate?.zigPerUsd ?? null,
            paymentMethod: draft.paymentMethod,
            serviceClass: draft.serviceClass,
            deliverBy: draft.deliverBy,
            status: DeliveryStatus.CREATED,
            searchGeneration: 0,
            searchStartedAt: now,
            nextRetryAt: new Date(now.getTime() + V2_SEARCH_WINDOW_MS),
            autoRetryCount: 0,
            createIdempotencyKey: key,
            createPayloadHash: hash,
          },
        });
        await tx.deliveryStatusEvent.create({
          data: {
            deliveryId: created.id,
            previousStatus: null,
            newStatus: DeliveryStatus.CREATED,
            actorId: customer.userId,
            actorType: DeliveryActorType.CUSTOMER,
          },
        });
        await recordDeliveryOpportunity(tx, { deliveryId: created.id, openedAt: now });
        return toCustomerDelivery(created as StoredDelivery);
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const existing = await this.replayCreate(this.prisma, key, hash, customer.customerAccountId);
      if (existing) {
        return existing;
      }
      throw new ConflictException(IDEMPOTENCY_CONFLICT);
    }
  }

  private async replayCreate(
    db: { delivery: { findUnique(args: { where: { createIdempotencyKey: string } }): Promise<unknown> } },
    key: string,
    hash: string,
    customerAccountId: string,
  ) {
    const existing = await db.delivery.findUnique({ where: { createIdempotencyKey: key } });
    if (!existing) {
      return null;
    }
    const row = existing as StoredDelivery & { customerId?: string; createPayloadHash?: string | null };
    if (row.createPayloadHash !== hash || row.customerId !== customerAccountId) {
      throw new ConflictException(IDEMPOTENCY_CONFLICT);
    }
    return toCustomerDelivery(row);
  }

  private async quoteServiceClass(request: QuoteRequest) {
    if (request.serviceClassRejected || request.serviceClass === null) {
      throw new BadRequestException('Choose Express or Flexible');
    }
    const active = await this.prisma.deliveryPricingConfig.findFirst({
      where: { isActive: true, serviceClass: request.serviceClass },
      include: {
        tiers: { orderBy: { position: 'asc' } },
        windows: true,
      },
    });
    if (!active) {
      throw classPricingUnavailable(request.serviceClass);
    }
    const metres = await this.roadMetres(request);
    let priced;
    try {
      priced = calculateTariffPrice(toClassSnapshot(active), metres, this.clock());
    } catch (error) {
      throw quotedPriceError(error);
    }
    const rate = await readActiveExchangeRate(this.prisma);
    const suggestedCents = roundSuggestedCents(suggestedCentsForCurrency(priced.suggestedPriceCents, request.currency, rate));
    return {
      distanceMeters: priced.distanceMetres,
      pricingVersion: priced.pricingVersion,
      pricingModel: priced.pricingModel,
      serviceClass: priced.serviceClass,
      pricingWindow: priced.pricingWindow,
      basisPoints: priced.basisPoints,
      currency: request.currency,
      suggestedPrice: formatCents(suggestedCents),
    };
  }

  private async roadMetres(pins: QuotePins): Promise<number> {
    try {
      return Math.round(await this.roads.metres(
        Number(pins.pickupLatitude),
        Number(pins.pickupLongitude),
        Number(pins.dropoffLatitude),
        Number(pins.dropoffLongitude),
      ));
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new BadRequestException('A road route is not available for these locations.');
    }
  }
}

type StoredClassTariff = {
  pricingVersion: number;
  pricingModel: PricingModel;
  serviceClass: ServiceClass | null;
  baseFee: string | { toFixed(digits: number): string };
  pricePerKilometre: string | { toFixed(digits: number): string };
  minimumTripMetres: number;
  maximumTripMetres: number;
  includedMetres?: number | null;
  tiers?: Array<{
    position: number;
    upToMetres: number | null;
    amount: string | { toFixed(digits: number): string };
  }>;
  windows?: Array<{
    id: string;
    kind: PricingWindowKind;
    enabled: boolean;
    daysOfWeek: number[];
    startsAt: string;
    endsAt: string;
    adjustmentBasisPoints: number;
    createdAt: Date;
  }>;
};

function toClassSnapshot(row: StoredClassTariff): TariffSnapshot {
  return {
    pricingVersion: row.pricingVersion,
    pricingModel: row.pricingModel,
    serviceClass: row.serviceClass,
    baseFeeCents: centsFromDecimal(row.baseFee),
    pricePerKilometreCents: centsFromDecimal(row.pricePerKilometre),
    minimumTripMetres: row.minimumTripMetres,
    maximumTripMetres: row.maximumTripMetres,
    includedMetres: row.includedMetres ?? null,
    tiers: [...(row.tiers ?? [])]
      .sort((left, right) => left.position - right.position)
      .map((tier) => ({
        position: tier.position,
        upToMetres: tier.upToMetres,
        amountCents: centsFromDecimal(tier.amount),
      })),
    windows: (row.windows ?? [])
      .filter((window) => window.enabled)
      .map((window) => ({
        id: window.id,
        kind: window.kind,
        enabled: window.enabled,
        daysOfWeek: [...window.daysOfWeek],
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        adjustmentBasisPoints: window.adjustmentBasisPoints,
        createdAt: window.createdAt,
      })),
  };
}

function classPricingUnavailable(serviceClass: ServiceClass): ConflictException {
  return new ConflictException(serviceClass === ServiceClass.FLEXIBLE
    ? 'Flexible pricing is not available'
    : 'Express pricing is not available');
}

function quotedPriceError(error: unknown): BadRequestException | ConflictException {
  if (error instanceof PricingCalculationError) {
    if (error.message === 'Trip is outside the configured range') {
      return new BadRequestException('Trip distance is outside the configured range');
    }
    if (error.message === 'Suggested price is too large') {
      return new BadRequestException('Suggested price is too large');
    }
    if (error.message === 'Distance is invalid') {
      return new BadRequestException('A road route is not available for these locations.');
    }
    return new ConflictException('The published tariff cannot be quoted');
  }
  if (error instanceof RangeError) {
    return new BadRequestException('Suggested price is too large');
  }
  throw error;
}

async function countOpenBids(
  prisma: PrismaService,
  rows: Array<{ id: string; status: DeliveryStatus; serviceClass?: ServiceClass | null }>,
  now: Date,
): Promise<Map<string, number>> {
  const deliveryIds = rows
    .filter((row) => row.status === DeliveryStatus.CREATED && (row.serviceClass === ServiceClass.EXPRESS || row.serviceClass === ServiceClass.FLEXIBLE))
    .map((row) => row.id);
  if (deliveryIds.length === 0) {
    return new Map();
  }
  const grouped = await prisma.bid.groupBy({
    by: ['deliveryId'],
    where: {
      deliveryId: { in: deliveryIds },
      status: BidStatus.OPEN,
      delivery: {
        OR: [
          { deliverBy: null },
          { deliverBy: { gt: now } },
        ],
      },
    },
    _count: { _all: true },
  });
  return new Map(grouped.map((row) => [row.deliveryId, row._count._all]));
}

function readPage(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (
    typeof value !== 'string'
    || !/^[0-9]+$/.test(value)
    || !Number.isSafeInteger(Number(value))
    || Number(value) < minimum
    || Number(value) > maximum
  ) {
    throw new BadRequestException('Invalid pagination parameter');
  }
  return Number(value);
}

function readStatuses(value: unknown): DeliveryStatus[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0) {
    return undefined;
  }
  const statuses: DeliveryStatus[] = [];
  for (const item of values) {
    if (typeof item !== 'string' || !Object.values(DeliveryStatus).includes(item as DeliveryStatus)) {
      throw new BadRequestException('Invalid delivery status');
    }
    statuses.push(item as DeliveryStatus);
  }
  return statuses;
}

function coordinateNumber(value: string | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function pointText(value: string | { toFixed(digits: number): string }): string {
  return typeof value === 'string' ? value : value.toFixed(7);
}

function pointTextOrNull(value: string | { toFixed(digits: number): string } | null | undefined): string | null {
  if (value == null) return null;
  return pointText(value);
}

function readIdempotencyKey(value: string | undefined): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key || key.length > 200) {
    throw new BadRequestException('Enter an idempotency key');
  }
  return key;
}

function creationHash(customerAccountId: string, draft: V2DeliveryDraft): string {
  return createHash('sha256')
    .update(JSON.stringify({
      kind: 'v2-delivery-create',
      customerAccountId,
      pickupAddress: draft.pickupAddress,
      pickupLatitude: draft.pickupLatitude,
      pickupLongitude: draft.pickupLongitude,
      pickupPlaceId: draft.pickupPlaceId,
      pickupCoordinateSource: draft.pickupCoordinateSource,
      pickupLandmark: draft.pickupLandmark,
      pickupInstructions: draft.pickupInstructions,
      pickupContactName: draft.pickupContactName,
      pickupContactPhone: draft.pickupContactPhone,
      dropoffAddress: draft.dropoffAddress,
      dropoffLatitude: draft.dropoffLatitude,
      dropoffLongitude: draft.dropoffLongitude,
      dropoffPlaceId: draft.dropoffPlaceId,
      dropoffCoordinateSource: draft.dropoffCoordinateSource,
      dropoffLandmark: draft.dropoffLandmark,
      dropoffInstructions: draft.dropoffInstructions,
      dropoffContactName: draft.dropoffContactName,
      dropoffContactPhone: draft.dropoffContactPhone,
      parcelDescription: draft.parcelDescription,
      parcelSize: draft.parcelSize,
      parcelInstructions: draft.parcelInstructions,
      serviceClass: draft.serviceClass,
      deliverBy: draft.deliverBy?.toISOString() ?? null,
      paymentMethod: draft.paymentMethod,
      offeredPriceCents: draft.offeredPriceCents,
      currency: draft.currency,
    }))
    .digest('hex');
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'P2002';
}


