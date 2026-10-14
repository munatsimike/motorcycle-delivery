import { BadRequestException } from '@nestjs/common';

const MONEY = /^(\d{1,10})\.(\d{2})$/;

export function readMoneyCents(value: unknown, allowZero: boolean, message: string): number {
  if (typeof value !== 'string' || !MONEY.test(value)) {
    throw new BadRequestException(message);
  }
  const [whole, fraction] = value.split('.') as [string, string];
  const cents = Number(whole) * 100 + Number(fraction);
  if (!Number.isSafeInteger(cents) || cents < 0 || (!allowZero && cents === 0)) {
    throw new BadRequestException(message);
  }
  return cents;
}

export function centsFromDecimal(value: string | { toFixed(digits: number): string }): number {
  const text = typeof value === 'string' ? value : value.toFixed(2);
  return readMoneyCents(text, true, 'Stored price is invalid');
}

export function formatCents(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const fraction = Math.abs(cents % 100);
  return `${whole}.${String(fraction).padStart(2, '0')}`;
}
