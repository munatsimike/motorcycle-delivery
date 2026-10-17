import type { PrismaClient } from '../generated/prisma/client.js';
import { DISPATCH_ROUND_RADII_METRES, GPS_FRESH_MS } from './dispatch.constants.js';

export const NEARBY_RIDER_RADIUS_METRES = DISPATCH_ROUND_RADII_METRES[0];

type NearbyCountRow = {
  count: number | bigint;
};

type NearbyQueryClient = Pick<PrismaClient, '$queryRaw'>;

export async function countNearbyAvailableRiders(
  db: NearbyQueryClient,
  input: { latitude: number; longitude: number; freshAfter: Date },
): Promise<number> {
  const rows = await db.$queryRaw<NearbyCountRow[]>`
    SELECT COUNT(*)::int AS "count"
    FROM "rider_locations" l
    INNER JOIN "rider_profiles" p ON p."id" = l."rider_profile_id"
    WHERE p."availability" = 'AVAILABLE'::"rider_availability"
      AND p."approval_status" = 'APPROVED'::"rider_approval_status"
      AND p."verification_status" = 'VERIFIED'::"rider_verification_status"
      AND l."updated_at" > ${input.freshAfter}
      AND ST_DWithin(
        l."position",
        ST_SetSRID(
          ST_MakePoint(${input.longitude}, ${input.latitude}),
          4326
        )::geography,
        ${NEARBY_RIDER_RADIUS_METRES}
      )
  `;
  const count = Number(rows[0]?.count ?? 0);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error('Nearby riders are unavailable.');
  }
  return count;
}

export function nearbyFreshAfter(now: Date): Date {
  return new Date(now.getTime() - GPS_FRESH_MS);
}
