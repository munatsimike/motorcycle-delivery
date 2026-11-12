import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Currency, PricingModel, PricingWindowKind, ServiceClass, type Prisma } from '../generated/prisma/client.js';
import type { AdminContext } from '../auth/admin-access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { readClassTariff, readEnabledFlag, readServiceClass, type ClassTariffInput } from './class-tariff-request.js';
import { centsFromDecimal, formatCents } from './money.js';
import { allocatePricingVersion, lockActiveClassPricing, lockPricingPublication } from './pricing-lock.js';

const CLASS_INCLUDE = {
  tiers: { orderBy: { position: 'asc' as const } },
  windows: { orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }] },
};

type StoredTier = {
  id: string;
  position: number;
  upToMetres: number | null;
  amount: string | { toFixed(digits: number): string };
};

type StoredWindow = {
  id: string;
  kind: PricingWindowKind;
  enabled: boolean;
  daysOfWeek: number[];
  startsAt: string;
  endsAt: string;
  adjustmentBasisPoints: number;
  createdAt: Date;
};

type StoredClassTariff = {
  id: string;
  serviceClass: ServiceClass | null;
  pricingVersion: number;
  pricingModel: PricingModel;
  baseFee: string | { toFixed(digits: number): string };
  pricePerKilometre: string | { toFixed(digits: number): string };
  minimumTripMetres: number;
  maximumTripMetres: number;
  includedMetres: number | null;
  isActive: boolean;
  tiers: StoredTier[];
  windows: StoredWindow[];
};

@Injectable()
export class ClassPricingService {
  constructor(private readonly prisma: PrismaService) {}

  async currentClasses() {
    const [express, flexible] = await Promise.all([
      this.loadActive(ServiceClass.EXPRESS) as Promise<StoredClassTariff | null>,
      this.loadActive(ServiceClass.FLEXIBLE) as Promise<StoredClassTariff | null>,
    ]);
    return {
      express: express ? toClassResponse(express) : null,
      flexible: flexible ? toClassResponse(flexible) : null,
    };
  }

  async currentClass(serviceClassValue: unknown) {
    const serviceClass = readServiceClass(serviceClassValue);
    const active = await this.loadActive(serviceClass) as StoredClassTariff | null;
    if (!active) {
      throw classUnavailable(serviceClass);
    }
    return toClassResponse(active);
  }

  async publish(admin: AdminContext, serviceClassValue: unknown, body: unknown) {
    const serviceClass = readServiceClass(serviceClassValue);
    const input = readClassTariff(body);
    return this.prisma.$transaction(async (tx) => {
      await lockPricingPublication(tx);
      await lockActiveClassPricing(tx, serviceClass);
      const active = await this.findActive(tx, serviceClass) as StoredClassTariff | null;
      return this.insertVersion(tx, admin, serviceClass, input, active);
    });
  }

  async setWindowEnabled(admin: AdminContext, serviceClassValue: unknown, windowId: string, body: unknown) {
    const serviceClass = readServiceClass(serviceClassValue);
    const enabled = readEnabledFlag(body);
    return this.prisma.$transaction(async (tx) => {
      await lockPricingPublication(tx);
      await lockActiveClassPricing(tx, serviceClass);
      const active = await this.findActive(tx, serviceClass) as StoredClassTariff | null;
      if (!active) {
        throw classUnavailable(serviceClass);
      }
      const window = active.windows.find((item) => item.id === windowId);
      if (!window) {
        throw new NotFoundException('Pricing window not found');
      }
      if (window.enabled === enabled) {
        return toClassResponse(active);
      }
      const input: ClassTariffInput = {
        pricingModel: active.pricingModel,
        baseFeeCents: centsFromDecimal(active.baseFee),
        pricePerKilometreCents: centsFromDecimal(active.pricePerKilometre),
        minimumTripMetres: active.minimumTripMetres,
        maximumTripMetres: active.maximumTripMetres,
        includedMetres: active.includedMetres,
        tiers: active.tiers.map((tier) => ({
          position: tier.position,
          upToMetres: tier.upToMetres,
          amountCents: centsFromDecimal(tier.amount),
        })),
        windows: active.windows.map((item) => ({
          kind: item.kind,
          enabled: item.id === windowId ? enabled : item.enabled,
          daysOfWeek: [...item.daysOfWeek],
          startsAt: item.startsAt,
          endsAt: item.endsAt,
          adjustmentBasisPoints: item.adjustmentBasisPoints,
        })),
      };
      return this.insertVersion(tx, admin, serviceClass, input, active);
    });
  }

  async audits(query: Record<string, unknown>) {
    const page = readPage(query.page, 1, 100_000);
    const limit = readPage(query.limit, 20, 100);
    const where = {};
    const [total, rows] = await Promise.all([
      this.prisma.pricingConfigAudit.count({ where }),
      this.prisma.pricingConfigAudit.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        actorId: row.actorId,
        previousVersion: row.previousVersion,
        nextVersion: row.nextVersion,
        createdAt: row.createdAt.toISOString(),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  private loadActive(serviceClass: ServiceClass) {
    return this.findActive(this.prisma, serviceClass);
  }

  private findActive(db: PrismaService | Prisma.TransactionClient, serviceClass: ServiceClass) {
    return db.deliveryPricingConfig.findFirst({
      where: { isActive: true, serviceClass },
      include: CLASS_INCLUDE,
    });
  }

  private async insertVersion(
    tx: Prisma.TransactionClient,
    admin: AdminContext,
    serviceClass: ServiceClass,
    input: ClassTariffInput,
    active: StoredClassTariff | null,
  ) {
    if (active) {
      await tx.deliveryPricingConfig.update({
        where: { id: active.id },
        data: { isActive: false },
      });
    }
    const created = await tx.deliveryPricingConfig.create({
      data: {
        pricingVersion: await allocatePricingVersion(tx),
        pricingModel: input.pricingModel,
        serviceClass,
        currency: Currency.USD,
        baseFee: formatCents(input.baseFeeCents),
        pricePerKilometre: formatCents(input.pricePerKilometreCents),
        minimumTripMetres: input.minimumTripMetres,
        maximumTripMetres: input.maximumTripMetres,
        includedMetres: input.includedMetres,
        isActive: true,
        createdById: admin.userId,
        tiers: {
          create: input.tiers.map((tier) => ({
            position: tier.position,
            upToMetres: tier.upToMetres,
            amount: formatCents(tier.amountCents),
          })),
        },
        windows: {
          create: input.windows.map((window) => ({
            kind: window.kind,
            enabled: window.enabled,
            daysOfWeek: window.daysOfWeek,
            startsAt: window.startsAt,
            endsAt: window.endsAt,
            adjustmentBasisPoints: window.adjustmentBasisPoints,
          })),
        },
      },
      include: CLASS_INCLUDE,
    });
    await tx.pricingConfigAudit.create({
      data: {
        actorId: admin.userId,
        previousVersion: active?.pricingVersion ?? null,
        nextVersion: created.pricingVersion,
      },
    });
    return toClassResponse(created as StoredClassTariff);
  }
}

function toClassResponse(row: StoredClassTariff) {
  return {
    serviceClass: row.serviceClass,
    pricingVersion: row.pricingVersion,
    pricingModel: row.pricingModel,
    currency: Currency.USD,
    baseFee: formatCents(centsFromDecimal(row.baseFee)),
    pricePerKilometre: formatCents(centsFromDecimal(row.pricePerKilometre)),
    minimumTripMetres: row.minimumTripMetres,
    maximumTripMetres: row.maximumTripMetres,
    includedMetres: row.includedMetres,
    isActive: row.isActive,
    tiers: [...row.tiers]
      .sort((left, right) => left.position - right.position)
      .map((tier) => ({
        id: tier.id,
        position: tier.position,
        upToMetres: tier.upToMetres,
        amount: formatCents(centsFromDecimal(tier.amount)),
      })),
    windows: [...row.windows]
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || (left.id < right.id ? -1 : 1))
      .map((window) => ({
        id: window.id,
        kind: window.kind,
        enabled: window.enabled,
        daysOfWeek: [...window.daysOfWeek],
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        adjustmentBasisPoints: window.adjustmentBasisPoints,
        createdAt: window.createdAt.toISOString(),
      })),
  };
}

function classUnavailable(serviceClass: ServiceClass): NotFoundException {
  return new NotFoundException(serviceClass === ServiceClass.FLEXIBLE
    ? 'Flexible pricing is not available'
    : 'Express pricing is not available');
}

function readPage(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) {
    return fallback;
  }
  const numeric = typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isInteger(numeric) || numeric < 1 || numeric > maximum) {
    throw new BadRequestException('Invalid pagination parameter');
  }
  return numeric;
}
