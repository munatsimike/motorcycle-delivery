import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Currency,
  DeliveryActorType,
  DeliveryStatus,
  DeliveryType,
} from '../generated/prisma/client.js';
import type { CustomerContext } from '../auth/customer-access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { readDeliveryDraft, readQuotePins, type QuotePins } from './delivery-request.js';
import { toCustomerDelivery, toCustomerDeliverySummary, type StoredDelivery } from './delivery-view.js';
import { centsFromDecimal, formatCents } from './money.js';
import { missingPricing } from './delivery-pricing.service.js';
import { lockActivePricing } from './pricing-lock.js';
import { straightLineMetres, suggestedCents } from './straight-line.js';

type ActiveTariff = {
  pricingVersion: number;
  baseFee: string | { toFixed(digits: number): string };
  pricePerKilometre: string | { toFixed(digits: number): string };
  minimumTripMetres: number;
  maximumTripMetres: number;
};

@Injectable()
export class DeliveryService {
  constructor(private readonly prisma: PrismaService) {}

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
    const pins = readQuotePins(body);
    const active = await this.prisma.deliveryPricingConfig.findFirst({ where: { isActive: true } });
    if (!active) {
      throw missingPricing();
    }
    const priced = pricePins(pins, active);
    return {
      distanceMeters: priced.distanceMeters,
      pricingVersion: priced.pricingVersion,
      currency: Currency.USD,
      suggestedPrice: priced.suggestedPrice,
    };
  }

  async create(customer: CustomerContext, body: unknown) {
    const draft = readDeliveryDraft(body);
    return this.prisma.$transaction(async (tx) => {
      const active = await lockActivePricing(tx);
      if (!active) {
        throw missingPricing();
      }
      const priced = pricePins(draft, active);
      const created = await tx.delivery.create({
        data: {
          customerId: customer.customerAccountId,
          deliveryType: DeliveryType.PARCEL,
          pickupAddress: draft.pickupAddress,
          pickupLatitude: draft.pickupLatitude,
          pickupLongitude: draft.pickupLongitude,
          pickupLandmark: draft.pickupLandmark,
          pickupInstructions: draft.pickupInstructions,
          pickupContactName: draft.pickupContactName,
          pickupContactPhone: draft.pickupContactPhone,
          dropoffAddress: draft.dropoffAddress,
          dropoffLatitude: draft.dropoffLatitude,
          dropoffLongitude: draft.dropoffLongitude,
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

function pricePins(pins: QuotePins, tariff: ActiveTariff) {
  const distanceMeters = straightLineMetres(
    Number(pins.pickupLatitude),
    Number(pins.pickupLongitude),
    Number(pins.dropoffLatitude),
    Number(pins.dropoffLongitude),
  );
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

