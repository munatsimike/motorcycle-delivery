import { BadRequestException, ConflictException } from '@nestjs/common';
import { Currency } from '../generated/prisma/client.js';

export const ZWG_OFFERS_DISABLED = 'ZWG_OFFERS_DISABLED';

const RATE_TEXT = /^(?:0|[1-9]\d{0,5})(?:\.\d{1,4})?$/;
const RATE_SCALE = 10_000;
const MAX_UNITS = 1_000_000 * RATE_SCALE;

export type ActiveExchangeRate = {
  rateVersion: number;
  zigPerUsdUnits: number;
  zigPerUsd: string;
};

export function readZigPerUsd(body: unknown): { units: number; text: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Enter the ZiG amount for 1 USD');
  }
  const value = (body as { zigPerUsd?: unknown }).zigPerUsd;
  if (typeof value !== 'string' || !RATE_TEXT.test(value.trim())) {
    throw new BadRequestException('Enter a positive exchange rate with at most four decimal places');
  }
  const units = zigPerUsdUnits(value.trim());
  if (units <= 0 || units > MAX_UNITS) {
    throw new BadRequestException('Enter a positive exchange rate with at most four decimal places');
  }
  return { units, text: formatZigPerUsd(units) };
}

export function zigPerUsdUnits(value: string | { toFixed(digits: number): string }): number {
  const text = typeof value === 'string' ? value : value.toFixed(4);
  const [whole, fraction = ''] = text.split('.');
  const digits = `${whole}${fraction.padEnd(4, '0').slice(0, 4)}`;
  const units = Number(digits);
  if (!Number.isSafeInteger(units)) {
    throw new BadRequestException('Enter a positive exchange rate with at most four decimal places');
  }
  return units;
}

export function formatZigPerUsd(units: number): string {
  const whole = Math.trunc(units / RATE_SCALE);
  const fraction = String(Math.abs(units % RATE_SCALE)).padStart(4, '0');
  return `${whole}.${fraction}`;
}

// Conversions use integer cents. The rate is ZiG per 1 USD in units of 1/10000.
// Half-up: a remainder of at least half the divisor rounds away from zero.
// A positive amount that rounds to 0 cents in the other currency cannot be paid there.
export function zigCentsFromUsdCents(usdCents: number, units: number): number {
  if (!Number.isSafeInteger(usdCents) || usdCents < 0 || !Number.isSafeInteger(units) || units <= 0) {
    throw new BadRequestException('The suggested price could not be calculated');
  }
  const scaled = usdCents * units;
  const cents = Math.floor(scaled / RATE_SCALE);
  const remainder = scaled % RATE_SCALE;
  return remainder >= RATE_SCALE / 2 ? cents + 1 : cents;
}

export function usdCentsFromZigCents(zigCents: number, units: number): number {
  if (!Number.isSafeInteger(zigCents) || zigCents < 0 || !Number.isSafeInteger(units) || units <= 0) {
    throw new BadRequestException('The commission could not be converted');
  }
  const scaled = BigInt(zigCents) * BigInt(RATE_SCALE);
  const divisor = BigInt(units);
  const cents = scaled / divisor;
  const remainder = scaled % divisor;
  const rounded = remainder * 2n >= divisor ? cents + 1n : cents;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new BadRequestException('The commission could not be converted');
  }
  return Number(rounded);
}

export function suggestedCentsForCurrency(
  usdCents: number,
  currency: Currency,
  rate: ActiveExchangeRate | null,
): number {
  if (currency !== Currency.ZWG) {
    return usdCents;
  }
  if (!rate) {
    throw new BadRequestException('An exchange rate has not been published');
  }
  return zigCentsFromUsdCents(usdCents, rate.zigPerUsdUnits);
}

export function riderZwgOffersEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RIDER_ZWG_OFFERS_ENABLED === 'true';
}

export function assertZwgOffersOpen(currency: Currency): void {
  if (currency === Currency.ZWG && !riderZwgOffersEnabled()) {
    throw new ConflictException({
      statusCode: 409,
      code: ZWG_OFFERS_DISABLED,
      message: 'ZiG deliveries are not available',
      error: 'Conflict',
    });
  }
}

type RateRow = {
  rateVersion: number;
  zigPerUsd: string | { toFixed(digits: number): string };
};

export async function readActiveExchangeRate(db: {
  exchangeRate?: { findFirst(args: { where: { isActive: boolean } }): Promise<RateRow | null> };
}): Promise<ActiveExchangeRate | null> {
  if (!db.exchangeRate) {
    return null;
  }
  const active = await db.exchangeRate.findFirst({ where: { isActive: true } });
  if (!active) {
    return null;
  }
  const units = zigPerUsdUnits(active.zigPerUsd);
  return { rateVersion: active.rateVersion, zigPerUsdUnits: units, zigPerUsd: formatZigPerUsd(units) };
}
