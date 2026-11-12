-- Expand the notice table for the current API and the next one.
-- The running API inserts assignment notices without dedupe_key. The
-- before-insert trigger fills that key, then the column is required.
-- Existing rows are backfilled and both unique keys stay in place.
-- This file does not change a delivery, bid, wallet, reservation, or commission rate.

ALTER TABLE "v2_outbox_events" ADD COLUMN "dedupe_key" VARCHAR(160);

UPDATE "v2_outbox_events"
SET "dedupe_key" = 'assignment:' || "assignment_id"::text || ':' || "event_type"::text
WHERE "dedupe_key" IS NULL;

CREATE OR REPLACE FUNCTION "v2_outbox_events_assign_dedupe_key"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."dedupe_key" IS NULL THEN
    IF NEW."assignment_id" IS NULL THEN
      RAISE EXCEPTION 'dedupe_key is required when assignment_id is null';
    END IF;
    NEW."dedupe_key" := 'assignment:' || NEW."assignment_id"::text || ':' || NEW."event_type"::text;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "v2_outbox_events_assign_dedupe_key" ON "v2_outbox_events";

CREATE TRIGGER "v2_outbox_events_assign_dedupe_key"
BEFORE INSERT ON "v2_outbox_events"
FOR EACH ROW
EXECUTE FUNCTION "v2_outbox_events_assign_dedupe_key"();

CREATE UNIQUE INDEX "v2_outbox_events_dedupe_key_key"
    ON "v2_outbox_events"("dedupe_key");

ALTER TABLE "v2_outbox_events" ALTER COLUMN "dedupe_key" SET NOT NULL;

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
