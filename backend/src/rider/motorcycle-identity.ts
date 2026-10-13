import { BadRequestException } from '@nestjs/common';

export type MotorcycleIdentity = {
  registrationNumber: string;
  make: string;
  model: string;
  colour: string;
};

export function readMotorcycleIdentity(body: unknown): MotorcycleIdentity {
  if (typeof body !== 'object' || body === null) {
    throw new BadRequestException('Enter the motorcycle details');
  }
  const record = body as Record<string, unknown>;
  return {
    registrationNumber: normalizeRegistrationNumber(record.registrationNumber),
    make: normalizeVehicleText(record.make, 'make', 80),
    model: normalizeVehicleText(record.model, 'model', 80),
    colour: normalizeVehicleText(record.colour, 'colour', 40),
  };
}

export function normalizeRegistrationNumber(value: unknown): string {
  const normalized = collapse(value);
  if (!normalized || normalized.length > 20) {
    throw new BadRequestException('Enter a registration number');
  }
  return normalized.toUpperCase();
}

export function normalizeVehicleText(value: unknown, field: 'make' | 'model' | 'colour', maxLength: number): string {
  const normalized = collapse(value);
  if (!normalized || normalized.length > maxLength) {
    throw new BadRequestException(`Enter a ${field}`);
  }
  return normalized;
}

function collapse(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const collapsed = value.trim().replace(/\s+/g, ' ');
  return collapsed.length > 0 ? collapsed : undefined;
}
