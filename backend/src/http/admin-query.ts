import { BadRequestException } from '@nestjs/common';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readAdminPage(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (
    typeof value !== 'string'
    || !/^[0-9]+$/.test(value)
    || !Number.isSafeInteger(Number(value))
    || Number(value) < min
    || Number(value) > max
  ) {
    throw new BadRequestException('Invalid pagination parameter');
  }
  return Number(value);
}

export function adminPage(page: number, limit: number, total: number) {
  return {
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}

export function readOptionalUuid(value: unknown, message: string): string | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  if (typeof value !== 'string' || !UUID_V7.test(value)) {
    throw new BadRequestException(message);
  }
  return value;
}
