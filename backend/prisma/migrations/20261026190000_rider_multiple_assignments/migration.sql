-- A rider may hold many Express, Flexible, and V1 ACCEPTED assignments.
-- One ACCEPTED assignment per delivery stays.
-- This file does not edit older migrations and does not insert or update rows.

DROP INDEX "delivery_assignments_one_live_express_per_rider_idx";

DROP INDEX "delivery_assignments_one_accepted_v1_per_rider_idx";
