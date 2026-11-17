-- Customer address book. One row is a reusable stop for the owning account.
-- This migration does not alter deliveries, wallets, cancellation notices,
-- or push devices. Deleting a saved address does not change a past delivery.
--
-- Prisma 7.1.0 cannot represent the partial unique indexes below.
-- Do not drop them in a later migration:
--   customer_saved_addresses_one_home_idx
--   customer_saved_addresses_one_work_idx
--   customer_saved_addresses_one_default_pickup_idx

CREATE TYPE "customer_saved_address_label" AS ENUM ('HOME', 'WORK', 'CUSTOM');

CREATE TABLE "customer_saved_addresses" (
    "id" UUID NOT NULL,
    "customer_account_id" UUID NOT NULL,
    "label" "customer_saved_address_label" NOT NULL,
    "custom_label" VARCHAR(40),
    "address" VARCHAR(500) NOT NULL,
    "latitude" DECIMAL(10, 7) NOT NULL,
    "longitude" DECIMAL(10, 7) NOT NULL,
    "place_id" VARCHAR(255),
    "coordinate_source" "coordinate_source" NOT NULL,
    "contact_name" VARCHAR(200) NOT NULL,
    "contact_phone" VARCHAR(20) NOT NULL,
    "is_default_pickup" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_saved_addresses_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "customer_saved_addresses"
    ADD CONSTRAINT "customer_saved_addresses_customer_account_id_fkey"
    FOREIGN KEY ("customer_account_id") REFERENCES "customer_accounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_saved_addresses"
    ADD CONSTRAINT "customer_saved_addresses_coordinates_chk"
    CHECK (
        "latitude" >= -90
        AND "latitude" <= 90
        AND "longitude" >= -180
        AND "longitude" <= 180
    );

ALTER TABLE "customer_saved_addresses"
    ADD CONSTRAINT "customer_saved_addresses_label_chk"
    CHECK (
        (
            "label" = 'CUSTOM'::"customer_saved_address_label"
            AND "custom_label" IS NOT NULL
            AND btrim("custom_label") <> ''
        )
        OR (
            "label" IN (
                'HOME'::"customer_saved_address_label",
                'WORK'::"customer_saved_address_label"
            )
            AND "custom_label" IS NULL
        )
    );

ALTER TABLE "customer_saved_addresses"
    ADD CONSTRAINT "customer_saved_addresses_source_chk"
    CHECK (
        (
            "coordinate_source" = 'GOOGLE_PLACES'::"coordinate_source"
            AND "place_id" IS NOT NULL
            AND btrim("place_id") <> ''
        )
        OR (
            "coordinate_source" = 'DEVICE_GEOCODER'::"coordinate_source"
            AND "place_id" IS NULL
        )
    );

ALTER TABLE "customer_saved_addresses"
    ADD CONSTRAINT "customer_saved_addresses_contact_chk"
    CHECK (
        btrim("address") <> ''
        AND btrim("contact_name") <> ''
        AND btrim("contact_phone") <> ''
    );

CREATE INDEX "customer_saved_addresses_customer_account_id_created_at_idx"
    ON "customer_saved_addresses"("customer_account_id", "created_at");

CREATE UNIQUE INDEX "customer_saved_addresses_one_home_idx"
    ON "customer_saved_addresses"("customer_account_id")
    WHERE "label" = 'HOME'::"customer_saved_address_label";

CREATE UNIQUE INDEX "customer_saved_addresses_one_work_idx"
    ON "customer_saved_addresses"("customer_account_id")
    WHERE "label" = 'WORK'::"customer_saved_address_label";

CREATE UNIQUE INDEX "customer_saved_addresses_one_default_pickup_idx"
    ON "customer_saved_addresses"("customer_account_id")
    WHERE "is_default_pickup";
