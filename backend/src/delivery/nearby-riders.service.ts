import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { countNearbyAvailableRiders, nearbyFreshAfter } from './nearby-riders.query.js';

export type NearbyRiderCount = {
  count: number;
};

@Injectable()
export class NearbyRidersService {
  constructor(private readonly prisma: PrismaService) {}

  async count(query: { latitude?: string; longitude?: string }, now = new Date()): Promise<NearbyRiderCount> {
    const point = readNearbyPoint(query);
    const count = await countNearbyAvailableRiders(this.prisma, {
      latitude: point.latitude,
      longitude: point.longitude,
      freshAfter: nearbyFreshAfter(now),
    });
    return { count };
  }
}

export function readNearbyPoint(query: { latitude?: string; longitude?: string }): { latitude: number; longitude: number } {
  return {
    latitude: readCoordinate(query.latitude, -90, 90),
    longitude: readCoordinate(query.longitude, -180, 180),
  };
}

function readCoordinate(value: string | undefined, minimum: number, maximum: number): number {
  if (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value.trim())) {
    throw new BadRequestException('Enter a valid location');
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < minimum || numeric > maximum) {
    throw new BadRequestException('Enter a valid location');
  }
  return numeric;
}
