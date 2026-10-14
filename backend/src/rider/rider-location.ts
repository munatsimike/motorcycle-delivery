import { BadRequestException } from '@nestjs/common';

export type GpsPoint = {
  latitude: string;
  longitude: string;
};

export function readGps(body: unknown): GpsPoint {
  const record = recordOf(body);
  return {
    latitude: readCoordinate(record.latitude, -90, 90),
    longitude: readCoordinate(record.longitude, -180, 180),
  };
}

function readCoordinate(value: unknown, minimum: number, maximum: number): string {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(numeric) || numeric < minimum || numeric > maximum) {
    throw new BadRequestException('Enter a valid location');
  }
  return numeric.toFixed(7);
}

function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException('Enter a valid location');
  }
  return value as Record<string, unknown>;
}
