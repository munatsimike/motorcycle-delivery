-- Phase 4B. A rider may hold many Flexible ACCEPTED assignments.
-- One live Express ACCEPTED assignment per rider. One V1 ACCEPTED assignment
-- per rider, identified by a null accepted bid amount. One ACCEPTED assignment
-- per delivery stays. Prisma cannot represent these partial indexes.
-- This file does not edit older migrations and does not insert or update rows.

DROP INDEX "delivery_assignments_one_accepted_per_rider_idx";

CREATE UNIQUE INDEX "delivery_assignments_one_live_express_per_rider_idx"
    ON "delivery_assignments" ("rider_profile_id")
    WHERE "status" = 'ACCEPTED' AND "service_class" = 'EXPRESS';

CREATE UNIQUE INDEX "delivery_assignments_one_accepted_v1_per_rider_idx"
    ON "delivery_assignments" ("rider_profile_id")
    WHERE "status" = 'ACCEPTED' AND "accepted_bid_amount" IS NULL;
