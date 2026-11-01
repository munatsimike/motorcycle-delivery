-- Idempotent marketplace notice rows. Assignment notices keep their
-- existing key. This file does not change a delivery, bid, wallet,
-- reservation, or commission rate.

ALTER TABLE "v2_outbox_events" ADD COLUMN "dedupe_key" VARCHAR(160);

UPDATE "v2_outbox_events"
SET "dedupe_key" = 'assignment:' || "assignment_id"::text || ':' || "event_type"::text
WHERE "dedupe_key" IS NULL;

ALTER TABLE "v2_outbox_events" ALTER COLUMN "dedupe_key" SET NOT NULL;

CREATE UNIQUE INDEX "v2_outbox_events_dedupe_key_key"
    ON "v2_outbox_events"("dedupe_key");

ALTER TABLE "v2_outbox_events" ALTER COLUMN "assignment_id" DROP NOT NULL;
ALTER TABLE "v2_outbox_events" ALTER COLUMN "delivery_id" DROP NOT NULL;

ALTER TABLE "v2_outbox_events" DROP CONSTRAINT "v2_outbox_events_recipient_chk";

ALTER TABLE "v2_outbox_events"
    ADD CONSTRAINT "v2_outbox_events_recipient_chk"
    CHECK (
        "attempt_count" >= 0
        AND (
            (
                "event_type" IN (
                    'BID_ACCEPTED'::"v2_outbox_event_type",
                    'ACCOUNT_APPROVED'::"v2_outbox_event_type"
                )
                AND "rider_profile_id" IS NOT NULL
                AND "customer_account_id" IS NULL
            )
            OR (
                "event_type" = 'RIDER_OPPORTUNITY'::"v2_outbox_event_type"
                AND "rider_profile_id" IS NULL
                AND "customer_account_id" IS NULL
                AND "delivery_id" IS NOT NULL
            )
            OR (
                "event_type" NOT IN (
                    'BID_ACCEPTED'::"v2_outbox_event_type",
                    'ACCOUNT_APPROVED'::"v2_outbox_event_type",
                    'RIDER_OPPORTUNITY'::"v2_outbox_event_type"
                )
                AND "customer_account_id" IS NOT NULL
                AND "rider_profile_id" IS NULL
            )
        )
    );
