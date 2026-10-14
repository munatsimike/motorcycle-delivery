-- Phase 5B customer delivery creation. Adds the admin-managed tariff and the
-- delivery snapshot columns. This file does not seed a commercial rate.
-- It does not assign riders, charge a wallet, or edit applied migrations.
--
-- Do not drop delivery_assignments_motorcycle_owner_fkey or
-- rider_licence_reviews_image_owner_fkey. Do not drop the existing delivery
-- checks. A future rider wallet may charge only the platform service fee
-- for a completed delivery, never deliveries.price or suggested_price.

DO $$
DECLARE
    delivery_count integer;
BEGIN
    SELECT count(*) INTO delivery_count FROM "deliveries";
    IF delivery_count > 0 THEN
        RAISE EXCEPTION
            'Cannot add delivery creation columns: % delivery row(s) exist and have no pickup contact or pricing snapshot',
            delivery_count;
    END IF;
END $$;

CREATE TYPE "parcel_size" AS ENUM ('SMALL', 'MEDIUM', 'LARGE');

CREATE TYPE "delivery_payer" AS ENUM ('SENDER', 'RECIPIENT');

CREATE TABLE "delivery_pricing_configs" (
    "id" UUID NOT NULL,
    "pricing_version" INTEGER NOT NULL,
    "currency" "currency" NOT NULL,
    "base_fee" DECIMAL(12,2) NOT NULL,
    "price_per_kilometre" DECIMAL(12,2) NOT NULL,
    "minimum_trip_metres" INTEGER NOT NULL,
    "maximum_trip_metres" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,

    CONSTRAINT "delivery_pricing_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "delivery_pricing_configs_pricing_version_key"
    ON "delivery_pricing_configs"("pricing_version");

CREATE INDEX "delivery_pricing_configs_created_by_id_idx"
    ON "delivery_pricing_configs"("created_by_id");

CREATE UNIQUE INDEX "delivery_pricing_configs_one_active_idx"
    ON "delivery_pricing_configs"("is_active")
    WHERE "is_active" = true;

ALTER TABLE "delivery_pricing_configs"
    ADD CONSTRAINT "delivery_pricing_configs_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "delivery_pricing_configs"
    ADD CONSTRAINT "delivery_pricing_configs_usd_chk"
    CHECK ("currency" = 'USD'::"currency");

ALTER TABLE "delivery_pricing_configs"
    ADD CONSTRAINT "delivery_pricing_configs_fee_chk"
    CHECK ("base_fee" >= 0 AND "price_per_kilometre" >= 0);

ALTER TABLE "delivery_pricing_configs"
    ADD CONSTRAINT "delivery_pricing_configs_distance_chk"
    CHECK ("minimum_trip_metres" >= 0 AND "maximum_trip_metres" > "minimum_trip_metres");

ALTER TABLE "deliveries"
    ADD COLUMN "pickup_landmark" VARCHAR(200),
    ADD COLUMN "pickup_instructions" VARCHAR(500),
    ADD COLUMN "pickup_contact_name" VARCHAR(200) NOT NULL,
    ADD COLUMN "pickup_contact_phone" VARCHAR(20) NOT NULL,
    ADD COLUMN "dropoff_landmark" VARCHAR(200),
    ADD COLUMN "dropoff_instructions" VARCHAR(500),
    ADD COLUMN "parcel_size" "parcel_size" NOT NULL,
    ADD COLUMN "parcel_instructions" VARCHAR(500),
    ADD COLUMN "suggested_price" DECIMAL(12,2) NOT NULL,
    ADD COLUMN "distance_meters" INTEGER NOT NULL,
    ADD COLUMN "pricing_version" INTEGER NOT NULL,
    ADD COLUMN "payer" "delivery_payer" NOT NULL;

ALTER TABLE "deliveries" ALTER COLUMN "recipient_name" SET NOT NULL;
ALTER TABLE "deliveries" ALTER COLUMN "recipient_phone" SET NOT NULL;

ALTER TABLE "deliveries"
    ADD CONSTRAINT "deliveries_suggested_price_nonnegative_chk"
    CHECK ("suggested_price" >= 0);

ALTER TABLE "deliveries"
    ADD CONSTRAINT "deliveries_distance_meters_nonnegative_chk"
    CHECK ("distance_meters" >= 0);

ALTER TABLE "deliveries"
    ADD CONSTRAINT "deliveries_pricing_version_chk"
    CHECK ("pricing_version" >= 1);

ALTER TABLE "deliveries"
    ADD CONSTRAINT "deliveries_pickup_contact_phone_e164_chk"
    CHECK ("pickup_contact_phone" ~ '^\+[1-9][0-9]{7,14}$');

ALTER TABLE "deliveries"
    ADD CONSTRAINT "deliveries_creation_text_chk"
    CHECK (
        btrim("pickup_address") <> ''
        AND btrim("dropoff_address") <> ''
        AND btrim("parcel_description") <> ''
        AND btrim("pickup_contact_name") <> ''
        AND btrim("recipient_name") <> ''
        AND ("pickup_landmark" IS NULL OR btrim("pickup_landmark") <> '')
        AND ("pickup_instructions" IS NULL OR btrim("pickup_instructions") <> '')
        AND ("dropoff_landmark" IS NULL OR btrim("dropoff_landmark") <> '')
        AND ("dropoff_instructions" IS NULL OR btrim("dropoff_instructions") <> '')
        AND ("parcel_instructions" IS NULL OR btrim("parcel_instructions") <> '')
    );
