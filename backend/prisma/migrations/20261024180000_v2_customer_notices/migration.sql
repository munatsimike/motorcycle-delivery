-- Customer status notices, one deadline reminder per assignment, a claim
-- lease, and customer FCM devices. The new outbox labels are added last so
-- this file does not use them. The recipient check allows BID_ACCEPTED for
-- the rider and every other type for the customer. This file does not insert
-- or update existing rows and does not recreate delivery_progress_commands.

ALTER TABLE "v2_outbox_events" DROP CONSTRAINT "v2_outbox_events_recipient_chk";

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
                "event_type" <> 'BID_ACCEPTED'::"v2_outbox_event_type"
                AND "customer_account_id" IS NOT NULL
                AND "rider_profile_id" IS NULL
            )
        )
    );

ALTER TABLE "v2_outbox_events" ADD COLUMN "claimed_at" TIMESTAMPTZ(6);
ALTER TABLE "v2_outbox_events" ADD COLUMN "claim_token" UUID;
ALTER TABLE "v2_outbox_events" ADD COLUMN "next_attempt_at" TIMESTAMPTZ(6);

CREATE TABLE "customer_fcm_devices" (
    "id" UUID NOT NULL,
    "customer_account_id" UUID NOT NULL,
    "fcm_token" VARCHAR(512) NOT NULL,
    "invalidated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_fcm_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_fcm_devices_fcm_token_key"
    ON "customer_fcm_devices"("fcm_token");

CREATE INDEX "customer_fcm_devices_customer_account_id_idx"
    ON "customer_fcm_devices"("customer_account_id");

ALTER TABLE "customer_fcm_devices"
    ADD CONSTRAINT "customer_fcm_devices_customer_account_id_fkey"
    FOREIGN KEY ("customer_account_id") REFERENCES "customer_accounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TYPE "v2_outbox_event_type" ADD VALUE IF NOT EXISTS 'COLLECTING';
ALTER TYPE "v2_outbox_event_type" ADD VALUE IF NOT EXISTS 'COLLECTED';
ALTER TYPE "v2_outbox_event_type" ADD VALUE IF NOT EXISTS 'OUT_FOR_DELIVERY';
ALTER TYPE "v2_outbox_event_type" ADD VALUE IF NOT EXISTS 'DELIVERED';
ALTER TYPE "v2_outbox_event_type" ADD VALUE IF NOT EXISTS 'DEADLINE_REMINDER';
