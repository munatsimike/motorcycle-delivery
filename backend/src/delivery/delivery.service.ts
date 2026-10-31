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
import { PrismaService } from '../prisma/prisma.service.js';
import { readDeliveryDraft, readQuoteRequest, readV2DeliveryDraft, type QuotePins, type QuoteRequest } from './delivery-request.js';
import { assignedRiderStatus, customerSharesRiderLocation, freshRiderPoint, toCustomerDelivery, toCustomerDeliverySummary, withAssignedRider, withCollectingRiderLocation, withPickupApproach, type AssignedRiderView, type PickupApproachView, type RiderPoint, type StoredDelivery } from './delivery-view.js';
import { PICKUP_APPROACH, type PickupApproachLookup } from './pickup-approach.js';
import { centsFromDecimal, formatCents } from './money.js';
import { lockActiveClassPricing } from './pricing-lock.js';
import { calculateTariffPrice, PricingCalculationError, type TariffSnapshot } from './pricing-calculator.js';
import { ROAD_DISTANCE, geoapifyRoadDistance, type RoadDistance } from './geoapify.js';
import { V2_SEARCH_WINDOW_MS } from './v2-search.js';

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
    });

    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }

    const view = toCustomerDelivery(delivery);
    const point = customerSharesRiderLocation(delivery.status)
      ? await this.collectingRiderPoint(delivery.id)
      : null;
    const rider = assignedRiderStatus(delivery.status) ? await this.assignedRider(delivery.id) : null;
    const approach = await this.pickupApproachFor(point, view.pickup.latitude, view.pickup.longitude);
    return withAssignedRider(withPickupApproach(withCollectingRiderLocation(view, point), approach), rider);
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
              where: { isActive: true, verificationStatus: 'VERIFIED' },
              select: { make: true, model: true },
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
    const phone = profile.user.phone?.trim() ?? '';
    const photo = await this.prisma.riderProfilePhoto.findFirst({
      where: { riderProfileId: profile.id, status: ProfilePhotoStatus.STORED },
      select: { id: true },
    });
    return {
      name,
      verified: profile.verificationStatus === 'VERIFIED',
      motorcycle: motorcycle || null,
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
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.delivery.count({ where }),
      this.prisma.delivery.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          status: true,
          createdAt: true,
          pickupAddress: true,
          dropoffAddress: true,
          serviceClass: true,
          deliverBy: true,
          currency: true,
          suggestedPrice: true,
          price: true,
          distanceMeters: true,
        },
      }),
    ]);
    const openBidCount = await countOpenBids(this.prisma, rows, new Date());
    return {
      data: rows.map((delivery) => toCustomerDeliverySummary(delivery, openBidCount.get(delivery.id) ?? 0)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async quote(body: unknown) {
    const request = readQuoteRequest(body);
    if (!v2MarketplaceEnabled()) {
      throw new NotFoundException('Bidding is not available');
    }
    return this.quoteServiceClass(request);
  }

  async create(customer: CustomerContext, body: unknown) {
    if (!v2MarketplaceEnabled()) {
      readDeliveryDraft(body);
      throw new NotFoundException('Bidding is not available');
    }
    return this.createV2Request(customer, body);
  }

  private async createV2Request(customer: CustomerContext, body: unknown) {
    const now = this.clock();
    const draft = readV2DeliveryDraft(body, now);
    const metres = await this.roadMetres(draft);
    return this.prisma.$transaction(async (tx) => {
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
          suggestedPrice: formatCents(priced.suggestedPriceCents),
          customerOffer: formatCents(draft.offeredPriceCents),
          distanceMeters: priced.distanceMetres,
          pricingVersion: priced.pricingVersion,
          pricingModel: priced.pricingModel,
          pricingBasisPoints: priced.basisPoints,
          pricingWindowId: priced.pricingWindow?.id ?? null,
          payer: null,
          currency: Currency.USD,
          paymentMethod: draft.paymentMethod,
          serviceClass: draft.serviceClass,
          deliverBy: draft.deliverBy,
          status: DeliveryStatus.CREATED,
          searchGeneration: 0,
          searchStartedAt: now,
          nextRetryAt: new Date(now.getTime() + V2_SEARCH_WINDOW_MS),
          autoRetryCount: 0,
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
      return toCustomerDelivery(created as StoredDelivery);
    });
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
    return {
      distanceMeters: priced.distanceMetres,
      pricingVersion: priced.pricingVersion,
      pricingModel: priced.pricingModel,
      serviceClass: priced.serviceClass,
      pricingWindow: priced.pricingWindow,
      basisPoints: priced.basisPoints,
      currency: Currency.USD,
      suggestedPrice: formatCents(priced.suggestedPriceCents),
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


