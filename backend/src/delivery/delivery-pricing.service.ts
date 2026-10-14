import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Currency } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { readTariffInput } from './delivery-request.js';
import { centsFromDecimal, formatCents } from './money.js';
import { lockActivePricing } from './pricing-lock.js';

export const PRICING_NOT_CONFIGURED = 'Delivery pricing is not configured';

type TariffRow = {
  id: string;
  pricingVersion: number;
  baseFee: string | { toFixed(digits: number): string };
  pricePerKilometre: string | { toFixed(digits: number): string };
  minimumTripMetres: number;
  maximumTripMetres: number;
};

type TariffInput = {
  baseFeeCents: number;
  pricePerKilometreCents: number;
  minimumTripMetres: number;
  maximumTripMetres: number;
};

@Injectable()
export class DeliveryPricingService {
  constructor(private readonly prisma: PrismaService) {}

  async current() {
    const active = await this.prisma.deliveryPricingConfig.findFirst({ where: { isActive: true } });
    if (!active) {
      throw new NotFoundException(PRICING_NOT_CONFIGURED);
    }
    return toTariffResponse(active);
  }

  async replace(admin: { userId: string }, body: unknown) {
    const input = readTariffInput(body);
    return this.prisma.$transaction(async (tx) => {
      const active = await lockActivePricing(tx);
      if (active && sameTariff(active, input)) {
        return toTariffResponse(active);
      }
      if (active) {
        await tx.deliveryPricingConfig.update({
          where: { id: active.id },
          data: { isActive: false },
        });
      }
      const created = await tx.deliveryPricingConfig.create({
        data: {
          pricingVersion: active ? active.pricingVersion + 1 : 1,
          currency: Currency.USD,
          baseFee: formatCents(input.baseFeeCents),
          pricePerKilometre: formatCents(input.pricePerKilometreCents),
          minimumTripMetres: input.minimumTripMetres,
          maximumTripMetres: input.maximumTripMetres,
          isActive: true,
          createdById: admin.userId,
        },
      });
      return toTariffResponse(created);
    });
  }
}

export function toTariffResponse(row: TariffRow) {
  return {
    pricingVersion: row.pricingVersion,
    currency: Currency.USD,
    baseFee: formatCents(centsFromDecimal(row.baseFee)),
    pricePerKilometre: formatCents(centsFromDecimal(row.pricePerKilometre)),
    minimumTripMetres: row.minimumTripMetres,
    maximumTripMetres: row.maximumTripMetres,
  };
}

function sameTariff(row: TariffRow, input: TariffInput): boolean {
  return centsFromDecimal(row.baseFee) === input.baseFeeCents
    && centsFromDecimal(row.pricePerKilometre) === input.pricePerKilometreCents
    && row.minimumTripMetres === input.minimumTripMetres
    && row.maximumTripMetres === input.maximumTripMetres;
}

export function missingPricing(): ConflictException {
  return new ConflictException(PRICING_NOT_CONFIGURED);
}
