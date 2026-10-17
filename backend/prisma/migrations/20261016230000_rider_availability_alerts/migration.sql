-- One-time customer alerts when an eligible rider is inside the saved 2 km area.
-- This script does not apply itself. It does not edit earlier migrations.
-- It does not change dispatch, rider availability, or delivery assignment.
--
-- position geography(Point,4326) and rider_availability_alerts_position_gix are
-- SQL-only. Do not drop them in a later generated diff. This script does not
-- write to PostGIS catalog relations.

CREATE TYPE "rider_availability_alert_status" AS ENUM (
    'ACTIVE',
    'SENDING',
    'NOTIFIED',
    'CANCELLED',
    'EXPIRED'
);

CREATE TABLE "customer_push_devices" (
    "id" UUID NOT NULL,
    "customer_account_id" UUID NOT NULL,
    "expo_push_token" VARCHAR(255) NOT NULL,
    "invalidated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_push_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_push_devices_expo_push_token_key"
    ON "customer_push_devices"("expo_push_token");

CREATE INDEX "customer_push_devices_customer_account_id_idx"
    ON "customer_push_devices"("customer_account_id");

ALTER TABLE "customer_push_devices"
    ADD CONSTRAINT "customer_push_devices_customer_account_id_fkey"
    FOREIGN KEY ("customer_account_id") REFERENCES "customer_accounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "rider_availability_alerts" (
    "id" UUID NOT NULL,
    "customer_account_id" UUID NOT NULL,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "position" geography(Point,4326) NOT NULL,
    "radius_metres" INTEGER NOT NULL DEFAULT 2000,
    "status" "rider_availability_alert_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "claimed_at" TIMESTAMPTZ(6),
    "notified_at" TIMESTAMPTZ(6),
    "next_attempt_at" TIMESTAMPTZ(6),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_failure" VARCHAR(40),

    CONSTRAINT "rider_availability_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rider_availability_alerts_position_gix"
    ON "rider_availability_alerts" USING GIST ("position");

CREATE INDEX "rider_availability_alerts_status_expires_at_idx"
    ON "rider_availability_alerts"("status", "expires_at");

CREATE UNIQUE INDEX "rider_availability_alerts_one_open_per_customer_idx"
    ON "rider_availability_alerts"("customer_account_id")
    WHERE "status" IN ('ACTIVE', 'SENDING');

ALTER TABLE "rider_availability_alerts"
    ADD CONSTRAINT "rider_availability_alerts_customer_account_id_fkey"
    FOREIGN KEY ("customer_account_id") REFERENCES "customer_accounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rider_availability_alerts"
    ADD CONSTRAINT "rider_availability_alerts_coordinate_chk"
    CHECK (
        "latitude" >= -90
        AND "latitude" <= 90
        AND "longitude" >= -180
        AND "longitude" <= 180
        AND "radius_metres" = 2000
        AND "attempt_count" >= 0
    );
