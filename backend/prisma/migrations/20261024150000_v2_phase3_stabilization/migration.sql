-- Phase 3 stabilization. Stores the accepted bid on the assignment so an
-- acceptance replay can return that bid after the bid is closed. Adds the
-- durable V2 outbox. This file does not send push notifications, does not
-- drop an assignment index, and does not insert or update existing rows.
--
-- A future worker claims unsent notices with:
--   SELECT id, event_type, delivery_id, assignment_id,
--          rider_profile_id, customer_account_id, attempt_count
--     FROM v2_outbox_events
--    WHERE status = 'PENDING'
--    ORDER BY created_at
--    FOR UPDATE SKIP LOCKED
--    LIMIT n
-- BID_ACCEPTED is for the rider: "Your bid was accepted. Collect the parcel."
-- REQUEST_REOPENED is for the customer: the rider cancelled and the original
-- request is open for bids again. After a successful send the worker sets
-- status = 'SENT' and sent_at. A failed send increments attempt_count and
-- leaves the row PENDING. The worker must not change the assignment, the
-- bid, or the delivery. The assignment stays valid if the notice is never sent.

ALTER TABLE "delivery_assignments" ADD COLUMN "accepted_bid_id" UUID;

CREATE UNIQUE INDEX "delivery_assignments_accepted_bid_id_key"
    ON "delivery_assignments"("accepted_bid_id");

ALTER TABLE "delivery_assignments"
    ADD CONSTRAINT "delivery_assignments_accepted_bid_id_fkey"
    FOREIGN KEY ("accepted_bid_id") REFERENCES "bids"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TYPE "v2_outbox_event_type" AS ENUM ('BID_ACCEPTED', 'REQUEST_REOPENED');
CREATE TYPE "v2_outbox_status" AS ENUM ('PENDING', 'SENT');

CREATE TABLE "v2_outbox_events" (
    "id" UUID NOT NULL,
    "event_type" "v2_outbox_event_type" NOT NULL,
    "status" "v2_outbox_status" NOT NULL DEFAULT 'PENDING',
    "delivery_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "rider_profile_id" UUID,
    "customer_account_id" UUID,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "v2_outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "v2_outbox_events_assignment_id_event_type_key"
    ON "v2_outbox_events"("assignment_id", "event_type");

CREATE INDEX "v2_outbox_events_status_created_at_idx"
    ON "v2_outbox_events"("status", "created_at");

ALTER TABLE "v2_outbox_events"
    ADD CONSTRAINT "v2_outbox_events_delivery_id_fkey"
    FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "v2_outbox_events"
    ADD CONSTRAINT "v2_outbox_events_assignment_id_fkey"
    FOREIGN KEY ("assignment_id") REFERENCES "delivery_assignments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "v2_outbox_events"
    ADD CONSTRAINT "v2_outbox_events_rider_profile_id_fkey"
    FOREIGN KEY ("rider_profile_id") REFERENCES "rider_profiles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "v2_outbox_events"
    ADD CONSTRAINT "v2_outbox_events_customer_account_id_fkey"
    FOREIGN KEY ("customer_account_id") REFERENCES "customer_accounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "v2_outbox_events"
    ADD CONSTRAINT "v2_outbox_events_recipient_chk"
    CHECK (
        "attempt_count" >= 0
        AND (
            (
                "event_type" = 'BID_ACCEPTED'::"v2_outbox_event_type"
                AND "rider_profile_id" IS NOT NULL
                AND "customer_account_id" IS NULL
            )
            OR (
                "event_type" = 'REQUEST_REOPENED'::"v2_outbox_event_type"
                AND "customer_account_id" IS NOT NULL
                AND "rider_profile_id" IS NULL
            )
        )
    );
