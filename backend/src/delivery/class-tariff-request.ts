import { BadRequestException } from '@nestjs/common';
import { Currency, PricingModel, PricingWindowKind, ServiceClass } from '../generated/prisma/client.js';
import { readMoneyCents } from './money.js';
import { calculateTariffPrice, PricingCalculationError, type TariffSnapshot } from './pricing-calculator.js';

const MODELS = new Set<string>(Object.values(PricingModel));
const WINDOW_KINDS = new Set<string>(Object.values(PricingWindowKind));
const PRICE_CHECK_AT = new Date('2026-01-05T10:00:00.000Z');

export type ClassTariffInput = {
  pricingModel: PricingModel;
  baseFeeCents: number;
  pricePerKilometreCents: number;
  minimumTripMetres: number;
  maximumTripMetres: number;
  tiers: Array<{ position: number; upToMetres: number | null; amountCents: number }>;
  windows: Array<{
    kind: PricingWindowKind;
    enabled: boolean;
    daysOfWeek: number[];
    startsAt: string;
    endsAt: string;
    adjustmentBasisPoints: number;
  }>;
};

export function readServiceClass(value: unknown): ServiceClass {
  if (value === ServiceClass.EXPRESS || value === ServiceClass.FLEXIBLE) {
    return value;
  }
  throw new BadRequestException('Choose Express or Flexible');
}

export function readClassTariff(body: unknown): ClassTariffInput {
  const record = recordOf(body, 'Enter the pricing configuration');
  if (record.currency !== undefined && record.currency !== Currency.USD) {
    throw new BadRequestException('USD is the only supported currency');
  }
  const pricingModel = readModel(record.pricingModel);
  const minimumTripMetres = readMetres(record.minimumTripMetres, 'Enter the minimum trip distance');
  const maximumTripMetres = readMetres(record.maximumTripMetres, 'Enter the maximum trip distance');
  if (maximumTripMetres <= minimumTripMetres) {
    throw new BadRequestException('Maximum trip distance must be greater than the minimum');
  }
  const tiers = readTiers(record.tiers, pricingModel);
  const windows = readWindows(record.windows);
  const input = {
    pricingModel,
    baseFeeCents: readModelMoney(record, pricingModel, 'baseFee', 'Enter the base fee', 'Base fee does not apply to this model'),
    pricePerKilometreCents: readModelMoney(record, pricingModel, 'pricePerKilometre', 'Enter the price per kilometre', 'Price per kilometre does not apply to this model'),
    minimumTripMetres,
    maximumTripMetres,
    tiers,
    windows,
  };
  assertNonNegativeQuotes(input);
  return input;
}

export function readEnabledFlag(body: unknown): boolean {
  const record = recordOf(body, 'Enter the window change');
  if (typeof record.enabled !== 'boolean') {
    throw new BadRequestException('Choose whether the window is enabled');
  }
  return record.enabled;
}

function readModelMoney(
  record: Record<string, unknown>,
  pricingModel: PricingModel,
  field: 'baseFee' | 'pricePerKilometre',
  requiredMessage: string,
  rejectedMessage: string,
): number {
  const usesBase = pricingModel === PricingModel.FIXED || pricingModel === PricingModel.BASE_PLUS_PER_KILOMETRE;
  const usesDistance = pricingModel === PricingModel.PER_KILOMETRE || pricingModel === PricingModel.BASE_PLUS_PER_KILOMETRE;
  const used = field === 'baseFee' ? usesBase : usesDistance;
  if (!used) {
    if (record[field] !== undefined) {
      throw new BadRequestException(rejectedMessage);
    }
    return 0;
  }
  return readMoneyCents(record[field], true, requiredMessage);
}

function readTiers(value: unknown, pricingModel: PricingModel): ClassTariffInput['tiers'] {
  if (pricingModel !== PricingModel.DISTANCE_TIERS) {
    if (value !== undefined && !(Array.isArray(value) && value.length === 0)) {
      throw new BadRequestException('Distance tiers do not apply to this model');
    }
    return [];
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new BadRequestException('Enter the distance tiers');
  }
  return value.map((item) => {
    const tier = recordOf(item, 'Enter the distance tiers');
    return {
      position: readTierPosition(tier.position),
      upToMetres: readUpperBound(tier.upToMetres),
      amountCents: readMoneyCents(tier.amount, true, 'Enter the tier amount'),
    };
  });
}

function readTierPosition(value: unknown): number {
  const position = readMetres(value, 'Enter the tier position');
  if (position < 1) {
    throw new BadRequestException('Enter the tier position');
  }
  return position;
}

function readUpperBound(value: unknown): number | null {
  if (value === null) {
    return null;
  }
  return readMetres(value, 'Enter the tier boundary');
}

function readWindows(value: unknown): ClassTariffInput['windows'] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new BadRequestException('Enter the pricing windows');
  }
  return value.map((item) => {
    const window = recordOf(item, 'Enter the pricing windows');
    if (!WINDOW_KINDS.has(String(window.kind))) {
      throw new BadRequestException('Choose a pricing window');
    }
    if (typeof window.enabled !== 'boolean') {
      throw new BadRequestException('Choose whether the window is enabled');
    }
    if (typeof window.adjustmentBasisPoints !== 'number' || !Number.isSafeInteger(window.adjustmentBasisPoints)) {
      throw new BadRequestException('Enter the window adjustment');
    }
    return {
      kind: window.kind as PricingWindowKind,
      enabled: window.enabled,
      daysOfWeek: readDays(window.daysOfWeek),
      startsAt: readClock(window.startsAt),
      endsAt: readClock(window.endsAt),
      adjustmentBasisPoints: window.adjustmentBasisPoints,
    };
  });
}

function readDays(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BadRequestException('Enter the window days');
  }
  const seen = new Set<number>();
  for (const day of value) {
    if (!Number.isSafeInteger(day) || day < 1 || day > 7 || seen.has(day)) {
      throw new BadRequestException('Enter the window days');
    }
    seen.add(day);
  }
  return [...value];
}

function readClock(value: unknown): string {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(value)) {
    throw new BadRequestException('Enter the window time');
  }
  return value;
}

function readModel(value: unknown): PricingModel {
  if (typeof value === 'string' && MODELS.has(value)) {
    return value as PricingModel;
  }
  throw new BadRequestException('Choose a pricing model');
}

function readMetres(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2_000_000_000) {
    throw new BadRequestException(message);
  }
  return value;
}

function assertNonNegativeQuotes(input: ClassTariffInput): void {
  const snapshot = toProbe(input, input.windows.map((window, index) => ({
    id: `window-${index + 1}`,
    ...window,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  })));
  const distances = quoteDistances(input);
  try {
    for (const distance of distances) {
      calculateTariffPrice(snapshot, distance, PRICE_CHECK_AT);
    }
    snapshot.windows.forEach((window, index) => {
      const forced = toProbe(input, [{
        ...window,
        id: `forced-${index + 1}`,
        enabled: true,
        daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
        startsAt: '00:00',
        endsAt: '23:59',
      }]);
      for (const distance of distances) {
        calculateTariffPrice(forced, distance, PRICE_CHECK_AT);
      }
    });
  } catch (error) {
    if (error instanceof PricingCalculationError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}

function quoteDistances(input: ClassTariffInput): number[] {
  const distances = [input.minimumTripMetres, input.maximumTripMetres];
  for (const tier of input.tiers) {
    if (tier.upToMetres !== null && tier.upToMetres >= input.minimumTripMetres && tier.upToMetres <= input.maximumTripMetres) {
      distances.push(tier.upToMetres);
    }
  }
  return distances;
}

function toProbe(input: ClassTariffInput, windows: TariffSnapshot['windows']): TariffSnapshot {
  return {
    pricingVersion: 1,
    pricingModel: input.pricingModel,
    serviceClass: ServiceClass.EXPRESS,
    baseFeeCents: input.baseFeeCents,
    pricePerKilometreCents: input.pricePerKilometreCents,
    minimumTripMetres: input.minimumTripMetres,
    maximumTripMetres: input.maximumTripMetres,
    tiers: input.tiers,
    windows,
  };
}

function recordOf(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException(message);
  }
  return value as Record<string, unknown>;
}
