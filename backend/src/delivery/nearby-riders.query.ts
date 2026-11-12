import type { PrismaClient } from '../generated/prisma/client.js';
import { DISPATCH_ROUND_RADII_METRES } from './dispatch.constants.js';

export const NEARBY_RIDER_RADIUS_METRES = DISPATCH_ROUND_RADII_METRES[0];
/** Covers a few missed 30s GPS uploads. Offline and out-of-range riders are still excluded immediately. */
export const NEARBY_RIDER_FRESH_MS = 120_000;
export const NEARBY_RIDER_POINT_TTL_MS = 90_000;
export const NEARBY_RIDER_BUCKET_METRES = 20;

export type NearbyRiderMapPoint = {
  latitude: number;
  longitude: number;
  expiresAt: string;
};

type NearbyCountRow = {
  count: number | bigint;
};

type NearbyPositionRow = {
  latitude: number | string | null;
  longitude: number | string | null;
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
    WHERE p."approval_status" = 'APPROVED'::"rider_approval_status"
      AND p."verification_status" = 'VERIFIED'::"rider_verification_status"
      AND l."updated_at" > ${input.freshAfter}
      AND (
        (
          p."availability" = 'AVAILABLE'::"rider_availability"
          AND p."receiving_requests" IS NOT FALSE
        )
        OR EXISTS (
          SELECT 1
          FROM "delivery_assignments" a
          INNER JOIN "deliveries" d ON d."id" = a."delivery_id"
          WHERE a."rider_profile_id" = p."id"
            AND a."status" = 'ACCEPTED'::"assignment_status"
            AND d."status" IN (
              'ASSIGNED'::"delivery_status",
              'RIDER_ASSIGNED'::"delivery_status",
              'COLLECTING'::"delivery_status",
              'COLLECTED'::"delivery_status",
              'OUT_FOR_DELIVERY'::"delivery_status",
              'ARRIVED_AT_PICKUP'::"delivery_status",
              'PICKED_UP'::"delivery_status",
              'IN_TRANSIT'::"delivery_status",
              'ARRIVED_AT_DROPOFF'::"delivery_status"
            )
        )
      )
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

export async function nearbyAvailableRiderPoints(
  db: NearbyQueryClient,
  input: { latitude: number; longitude: number; freshAfter: Date; now: Date },
): Promise<NearbyRiderMapPoint[]> {
  const rows = await db.$queryRaw<NearbyPositionRow[]>`
    SELECT
      ST_Y(l."position"::geometry) AS latitude,
      ST_X(l."position"::geometry) AS longitude
    FROM "rider_locations" l
    INNER JOIN "rider_profiles" p ON p."id" = l."rider_profile_id"
    WHERE p."approval_status" = 'APPROVED'::"rider_approval_status"
      AND p."verification_status" = 'VERIFIED'::"rider_verification_status"
      AND l."updated_at" > ${input.freshAfter}
      AND (
        (
          p."availability" = 'AVAILABLE'::"rider_availability"
          AND p."receiving_requests" IS NOT FALSE
        )
        OR EXISTS (
          SELECT 1
          FROM "delivery_assignments" a
          INNER JOIN "deliveries" d ON d."id" = a."delivery_id"
          WHERE a."rider_profile_id" = p."id"
            AND a."status" = 'ACCEPTED'::"assignment_status"
            AND d."status" IN (
              'ASSIGNED'::"delivery_status",
              'RIDER_ASSIGNED'::"delivery_status",
              'COLLECTING'::"delivery_status",
              'COLLECTED'::"delivery_status",
              'OUT_FOR_DELIVERY'::"delivery_status",
              'ARRIVED_AT_PICKUP'::"delivery_status",
              'PICKED_UP'::"delivery_status",
              'IN_TRANSIT'::"delivery_status",
              'ARRIVED_AT_DROPOFF'::"delivery_status"
            )
        )
      )
      AND ST_DWithin(
        l."position",
        ST_SetSRID(
          ST_MakePoint(${input.longitude}, ${input.latitude}),
          4326
        )::geography,
        ${NEARBY_RIDER_RADIUS_METRES}
      )
    ORDER BY l."updated_at" DESC
  `;
  return rows.map((row, index) => approximateNearbyRiderPoint(
    row.latitude,
    row.longitude,
    input.latitude,
    input.longitude,
    index,
    input.now,
  ));
}

export function nearbyFreshAfter(now: Date): Date {
  return new Date(now.getTime() - NEARBY_RIDER_FRESH_MS);
}

/** Same 20 m mask used for nearby riders, held on a 20 m cell so offer polling does not jump the marker. */
export function approximateCustomerMapPoint(
  latitude: number,
  longitude: number,
  seed: number,
): { latitude: number; longitude: number } {
  const spread = NEARBY_RIDER_BUCKET_METRES;
  const latitudeStep = spread / 111_320;
  const latitudeIndex = Math.round(latitude / latitudeStep);
  const bucketLatitude = latitudeIndex * latitudeStep;
  const cosine = Math.cos((bucketLatitude * Math.PI) / 180);
  const longitudeStep = spread / (111_320 * Math.max(0.2, Math.abs(cosine)));
  const bucketLongitude = Math.round(longitude / longitudeStep) * longitudeStep;
  const point = approximateNearbyRiderPoint(bucketLatitude, bucketLongitude, bucketLatitude, bucketLongitude, seed, new Date(0));
  return { latitude: point.latitude, longitude: point.longitude };
}

function approximateNearbyRiderPoint(
  latitude: number | string | null,
  longitude: number | string | null,
  customerLatitude: number,
  customerLongitude: number,
  index: number,
  now: Date,
): NearbyRiderMapPoint {
  const realLatitude = number(latitude);
  const realLongitude = number(longitude);
  const spread = NEARBY_RIDER_BUCKET_METRES;
  const scaleX = Math.sin((realLatitude + realLongitude + index + 7) * 12.9898) * 43758.5453;
  const scaleY = Math.cos((realLatitude - realLongitude + index + 13) * 11.1675) * 43758.5453;
  const maskX = (scaleX - Math.floor(scaleX)) * 2 - 1;
  const maskY = (scaleY - Math.floor(scaleY)) * 2 - 1;
  const latJitter = (maskX * spread) / 111_320;
  const lonJitter = (maskY * spread) / (111_320 * Math.cos((realLatitude * Math.PI) / 180));
  const latitudeValue = clamp(realLatitude + latJitter, -90, 90);
  const longitudeValue = wrapLongitude(realLongitude + lonJitter, customerLongitude);
  return {
    latitude: latitudeValue,
    longitude: longitudeValue,
    expiresAt: new Date(now.getTime() + NEARBY_RIDER_POINT_TTL_MS).toISOString(),
  };
}

function number(value: number | string | null): number {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) {
    throw new Error('Nearby riders are unavailable.');
  }
  return numeric;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function wrapLongitude(longitude: number, referenceLongitude: number): number {
  const diff = longitude - referenceLongitude;
  const wrapped = ((diff + 540) % 360) - 180;
  return referenceLongitude + wrapped;
}
