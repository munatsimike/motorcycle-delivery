-- Rider offer alerts. One outbox row per offered assignment, and one FCM
-- token per app install. This script does not apply itself and does not
-- change dispatch eligibility or the 60 second offer lifetime.

CREATE TYPE "rider_offer_notification_status" AS ENUM (
    'PENDING',
    'SENDING',
    'SENT',
    'SKIPPED'
);

CREATE TABLE "rider_offer_notifications" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "rider_profile_id" UUID NOT NULL,
    "status" "rider_offer_notification_status" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL,
    "claimed_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "skip_reason" VARCHAR(40),
    "last_failure" VARCHAR(40),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rider_offer_notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rider_offer_notifications_assignment_id_key"
    ON "rider_offer_notifications"("assignment_id");

CREATE INDEX "rider_offer_notifications_pending_idx"
    ON "rider_offer_notifications"("next_attempt_at")
    WHERE "status" = 'PENDING';

CREATE INDEX "rider_offer_notifications_sending_idx"
    ON "rider_offer_notifications"("claimed_at")
    WHERE "status" = 'SENDING';

ALTER TABLE "rider_offer_notifications"
    ADD CONSTRAINT "rider_offer_notifications_assignment_id_fkey"
    FOREIGN KEY ("assignment_id") REFERENCES "delivery_assignments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rider_offer_notifications"
    ADD CONSTRAINT "rider_offer_notifications_rider_profile_id_fkey"
    FOREIGN KEY ("rider_profile_id") REFERENCES "rider_profiles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "rider_push_devices" (
    "id" UUID NOT NULL,
    "rider_profile_id" UUID NOT NULL,
    "fcm_token" VARCHAR(512) NOT NULL,
    "invalidated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rider_push_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rider_push_devices_fcm_token_key"
    ON "rider_push_devices"("fcm_token");

CREATE INDEX "rider_push_devices_rider_profile_id_idx"
    ON "rider_push_devices"("rider_profile_id");

ALTER TABLE "rider_push_devices"
    ADD CONSTRAINT "rider_push_devices_rider_profile_id_fkey"
    FOREIGN KEY ("rider_profile_id") REFERENCES "rider_profiles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
