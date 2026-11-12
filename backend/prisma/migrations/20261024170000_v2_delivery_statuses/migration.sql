-- Milestone 5A. V2 deliveries progress through their own statuses.
-- V1 keeps ASSIGNED through ARRIVED_AT_DROPOFF.
-- Progress idempotency is stored apart from the acceptance key on the assignment.
-- This file does not edit older migrations and does not insert or update rows.

ALTER TYPE "delivery_status" ADD VALUE IF NOT EXISTS 'COLLECTING' AFTER 'RIDER_ASSIGNED';
ALTER TYPE "delivery_status" ADD VALUE IF NOT EXISTS 'COLLECTED' AFTER 'COLLECTING';
ALTER TYPE "delivery_status" ADD VALUE IF NOT EXISTS 'OUT_FOR_DELIVERY' AFTER 'COLLECTED';

CREATE TABLE "delivery_progress_commands" (
    "id" UUID NOT NULL,
    "idempotency_key" VARCHAR(200) NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "rider_profile_id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "requested_status" "delivery_status" NOT NULL,
    "result_status" "delivery_status" NOT NULL,
    "availability" "rider_availability" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_progress_commands_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "delivery_progress_commands_idempotency_key_key"
    ON "delivery_progress_commands"("idempotency_key");

CREATE INDEX "delivery_progress_commands_assignment_id_idx"
    ON "delivery_progress_commands"("assignment_id");

ALTER TABLE "delivery_progress_commands"
    ADD CONSTRAINT "delivery_progress_commands_rider_profile_id_fkey"
    FOREIGN KEY ("rider_profile_id") REFERENCES "rider_profiles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "delivery_progress_commands"
    ADD CONSTRAINT "delivery_progress_commands_delivery_id_fkey"
    FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "delivery_progress_commands"
    ADD CONSTRAINT "delivery_progress_commands_assignment_id_fkey"
    FOREIGN KEY ("assignment_id") REFERENCES "delivery_assignments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
