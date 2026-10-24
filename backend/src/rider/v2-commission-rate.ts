import { BadRequestException } from '@nestjs/common';

const PERCENTAGE = /^(?:0|[1-9]\d{0,2})(?:\.(\d{1,2}))?$/;

export function percentageFromBasisPoints(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const fraction = basisPoints % 100;
  if (fraction === 0) {
    return String(whole);
  }
  if (fraction % 10 === 0) {
    return `${whole}.${fraction / 10}`;
  }
  return `${whole}.${String(fraction).padStart(2, '0')}`;
}

export function readV2CommissionPercentage(body: unknown): number {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Enter the commission percentage');
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== 'percentage' || typeof record.percentage !== 'string') {
    throw new BadRequestException('Enter the commission percentage');
  }
  const value = record.percentage.trim().replace(/%$/, '');
  const match = PERCENTAGE.exec(value);
  if (!match) {
    throw new BadRequestException('Enter a commission percentage from 0 to 100');
  }
  const fraction = match[1] ?? '';
  const basisPoints = Number(value.split('.')[0]) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
    throw new BadRequestException('Enter a commission percentage from 0 to 100');
  }
  return basisPoints;
}
