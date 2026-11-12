-- Milestone 5. A pre-pickup cancellation keeps the accepted bid row and
-- its ACCEPTED status, and records when that acceptance ended. The partial
-- unique index then allows a later bid on the reopened delivery to be
-- accepted. This file does not drop an assignment index and does not insert
-- or update existing rows.

ALTER TYPE "assignment_release_reason" ADD VALUE IF NOT EXISTS 'PAYMENT_NOT_AGREED';
ALTER TYPE "assignment_release_reason" ADD VALUE IF NOT EXISTS 'PARCEL_NOT_AS_DESCRIBED';
ALTER TYPE "assignment_release_reason" ADD VALUE IF NOT EXISTS 'PARCEL_TOO_LARGE';
ALTER TYPE "assignment_release_reason" ADD VALUE IF NOT EXISTS 'SENDER_UNAVAILABLE';
ALTER TYPE "assignment_release_reason" ADD VALUE IF NOT EXISTS 'WRONG_ADDRESS';
ALTER TYPE "assignment_release_reason" ADD VALUE IF NOT EXISTS 'BREAKDOWN';
ALTER TYPE "assignment_release_reason" ADD VALUE IF NOT EXISTS 'OTHER';

ALTER TABLE "delivery_assignments" ADD COLUMN "cancellation_note" VARCHAR(500);
ALTER TABLE "delivery_assignments" ADD COLUMN "cancellation_stage" "delivery_status";
ALTER TABLE "delivery_assignments" ADD COLUMN "cancellation_idempotency_key" VARCHAR(200);
ALTER TABLE "delivery_assignments" ADD COLUMN "cancellation_payload_hash" CHAR(64);

CREATE UNIQUE INDEX "delivery_assignments_cancellation_idempotency_key_key"
    ON "delivery_assignments" ("cancellation_idempotency_key");

ALTER TABLE "delivery_assignments"
    ADD CONSTRAINT "delivery_assignments_cancellation_idempotency_chk"
    CHECK (
        (
            "cancellation_idempotency_key" IS NULL
            AND "cancellation_payload_hash" IS NULL
        )
        OR (
            "cancellation_idempotency_key" IS NOT NULL
            AND "cancellation_payload_hash" IS NOT NULL
            AND char_length("cancellation_idempotency_key") BETWEEN 1 AND 200
        )
    );

ALTER TABLE "bids" ADD COLUMN "closed_at" TIMESTAMPTZ(6);

DROP INDEX "bids_one_accepted_per_delivery_idx";

CREATE UNIQUE INDEX "bids_one_accepted_per_delivery_idx"
    ON "bids" ("delivery_id")
    WHERE "status" = 'ACCEPTED'::"bid_status"
      AND "closed_at" IS NULL;
