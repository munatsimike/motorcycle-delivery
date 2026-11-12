import { Injectable } from '@nestjs/common';
import type { RiderContext } from '../auth/rider-access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertServiceCoordinates } from '../delivery/service-area.js';
import { readGps } from './rider-location.js';

@Injectable()
export class RiderLocationService {
  constructor(private readonly prisma: PrismaService) {}

  async update(rider: RiderContext, body: unknown, now = new Date()): Promise<{ updatedAt: string }> {
    const point = readGps(body);
    assertServiceCoordinates(point.latitude, point.longitude);
    await this.prisma.$executeRaw`
      INSERT INTO "rider_locations" (
        "rider_profile_id",
        "latitude",
        "longitude",
        "position",
        "updated_at"
      ) VALUES (
        CAST(${rider.riderProfileId} AS uuid),
        ${point.latitude}::numeric,
        ${point.longitude}::numeric,
        ST_SetSRID(ST_MakePoint(${Number(point.longitude)}, ${Number(point.latitude)}), 4326)::geography,
        ${now}
      )
      ON CONFLICT ("rider_profile_id") DO UPDATE SET
        "latitude" = EXCLUDED."latitude",
        "longitude" = EXCLUDED."longitude",
        "position" = EXCLUDED."position",
        "updated_at" = EXCLUDED."updated_at"
    `;
    return { updatedAt: now.toISOString() };
  }
}
