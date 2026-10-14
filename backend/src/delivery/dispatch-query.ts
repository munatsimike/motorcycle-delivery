import type { Prisma } from '../generated/prisma/client.js';

export type DispatchCandidate = {
  riderProfileId: string;
};

// Straight-line distance on geography. Pickup coordinates stay decimal columns
// on the delivery. The point is built in the query and is not stored.
export async function findDispatchCandidates(
  tx: Prisma.TransactionClient,
  input: {
    pickupLatitude: string;
    pickupLongitude: string;
    radiusMetres: number;
    freshAfter: Date;
    deliveryId: string;
    searchGeneration: number;
  },
): Promise<DispatchCandidate[]> {
  return tx.$queryRaw<DispatchCandidate[]>`
    SELECT l."rider_profile_id" AS "riderProfileId"
    FROM "rider_locations" l
    INNER JOIN "rider_profiles" p ON p."id" = l."rider_profile_id"
    WHERE p."availability" = 'AVAILABLE'::"rider_availability"
      AND p."approval_status" = 'APPROVED'::"rider_approval_status"
      AND p."verification_status" = 'VERIFIED'::"rider_verification_status"
      AND l."updated_at" > ${input.freshAfter}
      AND ST_DWithin(
        l."position",
        ST_SetSRID(
          ST_MakePoint(${Number(input.pickupLongitude)}, ${Number(input.pickupLatitude)}),
          4326
        )::geography,
        ${input.radiusMetres}
      )
      AND NOT EXISTS (
        SELECT 1
        FROM "delivery_assignments" a
        WHERE a."delivery_id" = CAST(${input.deliveryId} AS uuid)
          AND a."rider_profile_id" = l."rider_profile_id"
          AND (
            a."status" = 'RELEASED'::"assignment_status"
            OR a."search_generation" = ${input.searchGeneration}
            OR a."status" IN ('OFFERED'::"assignment_status", 'ACCEPTED'::"assignment_status")
          )
      )
  `;
}
