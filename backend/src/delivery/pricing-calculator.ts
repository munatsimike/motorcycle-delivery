import { PricingModel, PricingWindowKind, ServiceClass } from '../generated/prisma/client.js';
import { suggestedCents } from './straight-line.js';

const BASIS_POINT_SCALE = 10_000n;
const MODELS = new Set<string>(Object.values(PricingModel));
const WINDOW_KINDS = new Set<string>(Object.values(PricingWindowKind));
const SERVICE_CLASSES = new Set<string>(Object.values(ServiceClass));
const CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const WINDOW_PRIORITY: Record<PricingWindowKind, number> = {
  [PricingWindowKind.NIGHT]: 0,
  [PricingWindowKind.PEAK]: 1,
  [PricingWindowKind.OFF_PEAK]: 2,
};

export class PricingCalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PricingCalculationError';
  }
}

export type PricingTierSnapshot = {
  position: number;
  upToMetres: number | null;
  amountCents: number;
};

export type PricingWindowSnapshot = {
  id: string;
  kind: PricingWindowKind;
  enabled: boolean;
  daysOfWeek: number[];
  startsAt: string;
  endsAt: string;
  adjustmentBasisPoints: number;
  createdAt: Date;
};

export type TariffSnapshot = {
  pricingVersion: number;
  pricingModel: PricingModel;
  serviceClass: ServiceClass | null;
  baseFeeCents: number;
  pricePerKilometreCents: number;
  minimumTripMetres: number;
  maximumTripMetres: number;
  tiers: PricingTierSnapshot[];
  windows: PricingWindowSnapshot[];
};

export type PricingCalculation = {
  pricingVersion: number;
  pricingModel: PricingModel;
  serviceClass: ServiceClass | null;
  distanceMetres: number;
  pricingWindow: { id: string; kind: PricingWindowKind } | null;
  basisPoints: number;
  suggestedPriceCents: number;
};

type ResolvedTier = {
  upToMetres: number;
  amountCents: number;
};

type ResolvedTariff = Omit<TariffSnapshot, 'tiers'> & {
  tiers: ResolvedTier[];
};

type LocalTime = {
  weekday: number;
  minuteOfDay: number;
};

// Days of week are ISO: Monday is 1 and Sunday is 7.
// A window whose end is less than or equal to its start crosses midnight.
// The end minute is exclusive, so adjacent windows do not both match.
// Tier amountCents is the per-kilometre rate for metres inside that slice.
export function calculateTariffPrice(snapshot: TariffSnapshot, distanceMetres: number, at: Date): PricingCalculation {
  const tariff = readTariff(snapshot);
  const distance = readDistance(distanceMetres, tariff.minimumTripMetres, tariff.maximumTripMetres);
  const baseCents = basePriceCents(tariff, distance);
  const selected = selectWindow(tariff.windows, at);
  const basisPoints = selected?.adjustmentBasisPoints ?? 0;
  const suggestedPriceCents = applyBasisPoints(baseCents, basisPoints);
  if (suggestedPriceCents < 0) {
    throw new PricingCalculationError('Suggested price is negative');
  }
  return {
    pricingVersion: tariff.pricingVersion,
    pricingModel: tariff.pricingModel,
    serviceClass: tariff.serviceClass,
    distanceMetres: distance,
    pricingWindow: selected ? { id: selected.id, kind: selected.kind } : null,
    basisPoints,
    suggestedPriceCents,
  };
}

function readTariff(snapshot: TariffSnapshot): ResolvedTariff {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new PricingCalculationError('Pricing configuration is invalid');
  }
  if (!Number.isSafeInteger(snapshot.pricingVersion) || snapshot.pricingVersion < 1) {
    throw new PricingCalculationError('Pricing configuration is invalid: pricing version is invalid');
  }
  if (!MODELS.has(snapshot.pricingModel)) {
    throw new PricingCalculationError('Pricing configuration is invalid: pricing model is invalid');
  }
  if (snapshot.serviceClass !== null && !SERVICE_CLASSES.has(snapshot.serviceClass)) {
    throw new PricingCalculationError('Pricing configuration is invalid: service class is invalid');
  }
  const baseFeeCents = readNonNegativeCents(snapshot.baseFeeCents, 'base fee');
  const pricePerKilometreCents = readNonNegativeCents(snapshot.pricePerKilometreCents, 'price per kilometre');
  if (!Number.isSafeInteger(snapshot.minimumTripMetres) || snapshot.minimumTripMetres < 0) {
    throw new PricingCalculationError('Pricing configuration is invalid: minimum trip is invalid');
  }
  if (!Number.isSafeInteger(snapshot.maximumTripMetres) || snapshot.maximumTripMetres < snapshot.minimumTripMetres) {
    throw new PricingCalculationError('Pricing configuration is invalid: maximum trip is invalid');
  }
  const tiers = readTiers(snapshot);
  const windows = readWindows(snapshot.windows);
  return {
    pricingVersion: snapshot.pricingVersion,
    pricingModel: snapshot.pricingModel,
    serviceClass: snapshot.serviceClass,
    baseFeeCents,
    pricePerKilometreCents,
    minimumTripMetres: snapshot.minimumTripMetres,
    maximumTripMetres: snapshot.maximumTripMetres,
    tiers,
    windows,
  };
}

function readNonNegativeCents(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new PricingCalculationError(`Pricing configuration is invalid: ${label} is invalid`);
  }
  if (value < 0) {
    throw new PricingCalculationError(`Pricing configuration is invalid: ${label} is negative`);
  }
  return value;
}

function readTiers(snapshot: TariffSnapshot): ResolvedTier[] {
  if (!Array.isArray(snapshot.tiers)) {
    throw new PricingCalculationError('Pricing configuration is invalid: tiers are invalid');
  }
  if (snapshot.pricingModel !== PricingModel.DISTANCE_TIERS) {
    if (snapshot.tiers.length > 0) {
      throw new PricingCalculationError('Pricing configuration is invalid: tiers belong only to the distance-tier model');
    }
    return [];
  }
  if (snapshot.tiers.length === 0) {
    throw new PricingCalculationError('Pricing configuration is invalid: distance tiers are missing');
  }
  const ordered = [...snapshot.tiers].sort((left, right) => left.position - right.position);
  let previous = 0;
  return ordered.map((tier, index) => {
    if (!tier || !Number.isSafeInteger(tier.position) || tier.position !== index + 1) {
      throw new PricingCalculationError('Pricing configuration is invalid: tier positions have a gap');
    }
    const amountCents = readNonNegativeCents(tier.amountCents, 'tier amount');
    if (tier.upToMetres !== null && (!Number.isSafeInteger(tier.upToMetres) || tier.upToMetres < 0)) {
      throw new PricingCalculationError('Pricing configuration is invalid: tier boundary is invalid');
    }
    if (tier.upToMetres === null && index !== ordered.length - 1) {
      throw new PricingCalculationError('Pricing configuration is invalid: an open tier is not last');
    }
    const upToMetres = tier.upToMetres ?? snapshot.maximumTripMetres;
    const zeroRange = snapshot.maximumTripMetres === 0 && upToMetres === 0 && previous === 0;
    if (upToMetres < previous || (upToMetres === previous && !zeroRange)) {
      throw new PricingCalculationError('Pricing configuration is invalid: tier boundaries overlap');
    }
    if (upToMetres > snapshot.maximumTripMetres) {
      throw new PricingCalculationError('Pricing configuration is invalid: tiers extend beyond the configured range');
    }
    previous = upToMetres;
    if (index === ordered.length - 1 && upToMetres !== snapshot.maximumTripMetres) {
      throw new PricingCalculationError('Pricing configuration is invalid: tiers do not cover the configured range');
    }
    return { upToMetres, amountCents };
  });
}

function readWindows(windows: PricingWindowSnapshot[]): PricingWindowSnapshot[] {
  if (!Array.isArray(windows)) {
    throw new PricingCalculationError('Pricing configuration is invalid: windows are invalid');
  }
  const ids = new Set<string>();
  return windows.map((window) => {
    if (!window || typeof window.id !== 'string' || window.id.length === 0 || ids.has(window.id)) {
      throw new PricingCalculationError('Pricing configuration is invalid: window id is invalid');
    }
    ids.add(window.id);
    if (!WINDOW_KINDS.has(window.kind)) {
      throw new PricingCalculationError('Pricing configuration is invalid: window kind is invalid');
    }
    if (typeof window.enabled !== 'boolean') {
      throw new PricingCalculationError('Pricing configuration is invalid: window enabled flag is invalid');
    }
    readDays(window.daysOfWeek);
    readClock(window.startsAt);
    readClock(window.endsAt);
    if (!Number.isSafeInteger(window.adjustmentBasisPoints)) {
      throw new PricingCalculationError('Pricing configuration is invalid: basis points are invalid');
    }
    if (!(window.createdAt instanceof Date) || Number.isNaN(window.createdAt.getTime())) {
      throw new PricingCalculationError('Pricing configuration is invalid: window timestamp is invalid');
    }
    return { ...window, daysOfWeek: [...window.daysOfWeek] };
  });
}

function readDays(days: number[]): void {
  if (!Array.isArray(days) || days.length === 0) {
    throw new PricingCalculationError('Pricing configuration is invalid: window days are invalid');
  }
  const seen = new Set<number>();
  for (const day of days) {
    if (!Number.isSafeInteger(day) || day < 1 || day > 7 || seen.has(day)) {
      throw new PricingCalculationError('Pricing configuration is invalid: window days are invalid');
    }
    seen.add(day);
  }
}

function readClock(value: string): number {
  if (typeof value !== 'string') {
    throw new PricingCalculationError('Pricing configuration is invalid: window time is invalid');
  }
  const match = CLOCK_TIME.exec(value);
  if (!match) {
    throw new PricingCalculationError('Pricing configuration is invalid: window time is invalid');
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function readDistance(distanceMetres: number, minimumTripMetres: number, maximumTripMetres: number): number {
  if (typeof distanceMetres !== 'number' || !Number.isSafeInteger(distanceMetres) || distanceMetres < 0) {
    throw new PricingCalculationError('Distance is invalid');
  }
  if (distanceMetres < minimumTripMetres || distanceMetres > maximumTripMetres) {
    throw new PricingCalculationError('Trip is outside the configured range');
  }
  return distanceMetres;
}

function basePriceCents(tariff: ResolvedTariff, distanceMetres: number): number {
  if (tariff.pricingModel === PricingModel.FIXED) {
    return tariff.baseFeeCents;
  }
  if (tariff.pricingModel === PricingModel.PER_KILOMETRE) {
    return distanceChargeCents(tariff.pricePerKilometreCents, distanceMetres);
  }
  if (tariff.pricingModel === PricingModel.BASE_PLUS_PER_KILOMETRE) {
    return suggestedCents(distanceMetres, tariff);
  }
  return marginalTierCents(tariff.tiers, distanceMetres);
}

function distanceChargeCents(rateCents: number, metres: number): number {
  return suggestedCents(metres, { baseFeeCents: 0, pricePerKilometreCents: rateCents });
}

function marginalTierCents(tiers: ResolvedTier[], distanceMetres: number): number {
  let previous = 0;
  let total = 0;
  for (const tier of tiers) {
    if (distanceMetres <= previous) {
      break;
    }
    const end = Math.min(distanceMetres, tier.upToMetres);
    const charge = distanceChargeCents(tier.amountCents, end - previous);
    if (total > Number.MAX_SAFE_INTEGER - charge) {
      throw new PricingCalculationError('Suggested price is too large');
    }
    total += charge;
    previous = tier.upToMetres;
  }
  if (previous < distanceMetres) {
    throw new PricingCalculationError('Pricing configuration is invalid: tiers do not cover the trip');
  }
  return total;
}

function selectWindow(windows: PricingWindowSnapshot[], at: Date): PricingWindowSnapshot | null {
  const local = harareLocal(at);
  const matches = windows.filter((window) => window.enabled && windowMatches(window, local));
  matches.sort((left, right) => {
    const priority = WINDOW_PRIORITY[left.kind] - WINDOW_PRIORITY[right.kind];
    if (priority !== 0) {
      return priority;
    }
    const saved = right.createdAt.getTime() - left.createdAt.getTime();
    if (saved !== 0) {
      return saved;
    }
    if (left.id === right.id) {
      return 0;
    }
    return left.id < right.id ? 1 : -1;
  });
  return matches[0] ?? null;
}

function windowMatches(window: PricingWindowSnapshot, local: LocalTime): boolean {
  const start = readClock(window.startsAt);
  const end = readClock(window.endsAt);
  const days = new Set(window.daysOfWeek);
  if (start < end) {
    return days.has(local.weekday) && local.minuteOfDay >= start && local.minuteOfDay < end;
  }
  const yesterday = local.weekday === 1 ? 7 : local.weekday - 1;
  const startedToday = local.minuteOfDay >= start && days.has(local.weekday);
  const stillOpenFromYesterday = local.minuteOfDay < end && days.has(yesterday);
  return startedToday || stillOpenFromYesterday;
}

function harareLocal(at: Date): LocalTime {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
    throw new PricingCalculationError('Pricing instant is invalid');
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Harare',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const weekday = WEEKDAYS[part(parts, 'weekday')];
  let hour = Number(part(parts, 'hour'));
  const minute = Number(part(parts, 'minute'));
  if (hour === 24) {
    hour = 0;
  }
  if (!weekday || !Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) {
    throw new PricingCalculationError('Harare local time is invalid');
  }
  return { weekday, minuteOfDay: hour * 60 + minute };
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((item) => item.type === type)?.value ?? '';
}

function applyBasisPoints(baseCents: number, basisPoints: number): number {
  const numerator = BigInt(baseCents) * (BASIS_POINT_SCALE + BigInt(basisPoints));
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const quotient = absolute / BASIS_POINT_SCALE;
  const remainder = absolute % BASIS_POINT_SCALE;
  const rounded = remainder >= BASIS_POINT_SCALE / 2n ? quotient + 1n : quotient;
  const signed = negative ? -rounded : rounded;
  if (signed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new PricingCalculationError('Suggested price is too large');
  }
  return Number(signed);
}
