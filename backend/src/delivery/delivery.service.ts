import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import {
  Currency,
  DeliveryActorType,
  DeliveryStatus,
  DeliveryType,
  PricingModel,
  PricingWindowKind,
  ServiceClass,
} from '../generated/prisma/client.js';
import type { CustomerContext } from '../auth/customer-access.service.js';
import { v2MarketplaceEnabled } from '../auth/v2-flags.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { readDeliveryDraft, readQuoteRequest, type QuotePins, type QuoteRequest } from './delivery-request.js';
import { toCustomerDelivery, toCustomerDeliverySummary, type StoredDelivery } from './delivery-view.js';
import { centsFromDecimal, formatCents } from './money.js';
import { missingPricing } from './delivery-pricing.service.js';
import { activeV1PricingWhere, lockActivePricing } from './pricing-lock.js';
import { calculateTariffPrice, PricingCalculationError, type TariffSnapshot } from './pricing-calculator.js';
import { ROAD_DISTANCE, geoapifyRoadDistance, type RoadDistance } from './geoapify.js';
import { suggestedCents } from './straight-line.js';

export const PRICING_CLOCK = Symbol('PRICING_CLOCK');

type ActiveTariff = {
  pricingVersion: number;
  baseFee: string | { toFixed(digits: number): string };
  pricePerKilometre: string | { toFixed(digits: number): string };
  minimumTripMetres: number;
  maximumTripMetres: number;
};

@Injectable()
export class DeliveryService {
  private readonly roads: RoadDistance;
  private readonly clock: () => Date;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(ROAD_DISTANCE) roads?: RoadDistance,
    @Optional() @Inject(PRICING_CLOCK) clock?: () => Date,
  ) {
    this.roads = roads ?? geoapifyRoadDistance();
    this.clock = clock ?? (() => new Date());
  }

  async getById(customer: CustomerContext, deliveryId: string) {
    const delivery = await this.prisma.delivery.findFirst({
      where: {
        id: deliveryId,
        customerId: customer.customerAccountId,
      },
    });

    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }

    return toCustomerDelivery(delivery);
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
        },
      }),
    ]);
    return {
      data: rows.map((delivery) => toCustomerDeliverySummary(delivery)),
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
    if (v2MarketplaceEnabled()) {
      return this.quoteServiceClass(request);
    }
    const active = await this.prisma.deliveryPricingConfig.findFirst({ where: activeV1PricingWhere });
    if (!active) {
      throw missingPricing();
    }
    const priced = this.priceMetres(await this.roadMetres(request), active);
    return {
      distanceMeters: priced.distanceMeters,
      pricingVersion: priced.pricingVersion,
      currency: Currency.USD,
      suggestedPrice: priced.suggestedPrice,
    };
  }

  async create(customer: CustomerContext, body: unknown) {
    const draft = readDeliveryDraft(body);
    const metres = await this.roadMetres(draft);
    return this.prisma.$transaction(async (tx) => {
      const active = await lockActivePricing(tx);
      if (!active) {
        throw missingPricing();
      }
      const priced = this.priceMetres(metres, active);
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
          price: formatCents(draft.offeredPriceCents),
          suggestedPrice: priced.suggestedPrice,
          distanceMeters: priced.distanceMeters,
          pricingVersion: priced.pricingVersion,
          payer: draft.payer,
          currency: Currency.USD,
          paymentMethod: draft.paymentMethod,
          status: DeliveryStatus.CREATED,
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

  private priceMetres(distanceMeters: number, tariff: ActiveTariff) {
    if (!Number.isSafeInteger(distanceMeters) || distanceMeters < 0) {
      throw new BadRequestException('A road route is not available for these locations.');
    }
    if (distanceMeters < tariff.minimumTripMetres || distanceMeters > tariff.maximumTripMetres) {
      throw new BadRequestException('Trip distance is outside the configured range');
    }
    let cents: number;
    try {
      cents = suggestedCents(distanceMeters, {
        baseFeeCents: centsFromDecimal(tariff.baseFee),
        pricePerKilometreCents: centsFromDecimal(tariff.pricePerKilometre),
      });
    } catch (error) {
      if (error instanceof RangeError) {
        throw new BadRequestException('Suggested price is too large');
      }
      throw error;
    }
    return {
      distanceMeters,
      pricingVersion: tariff.pricingVersion,
      suggestedPrice: formatCents(cents),
    };
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


