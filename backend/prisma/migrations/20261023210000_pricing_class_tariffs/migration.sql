-- Separate V1, Express, and Flexible tariffs.
-- Existing pricing rows stay on the null service class and the base-plus-per-kilometre model.
-- Prices, distances, and pricing_version values are not rewritten.
-- Do not drop these from a later generated migration:
--   delivery_pricing_configs_one_active_v1_idx
--   delivery_pricing_configs_one_active_per_class_idx
--   delivery_assignments_one_accepted_per_rider_idx
--   bids_one_open_per_rider_delivery_idx
--   bids_one_accepted_per_delivery_idx
--   users_account_credential_chk

CREATE TYPE "pricing_model" AS ENUM (
    'FIXED',
    'PER_KILOMETRE',
    'BASE_PLUS_PER_KILOMETRE',
    'DISTANCE_TIERS'
);

ALTER TABLE "delivery_pricing_configs"
    ADD COLUMN "pricing_model" "pricing_model",
    ADD COLUMN "service_class" "service_class";

UPDATE "delivery_pricing_configs"
SET "pricing_model" = 'BASE_PLUS_PER_KILOMETRE'
WHERE "pricing_model" IS NULL;

ALTER TABLE "delivery_pricing_configs"
    ALTER COLUMN "pricing_model" SET NOT NULL,
    ALTER COLUMN "pricing_model" SET DEFAULT 'BASE_PLUS_PER_KILOMETRE';

CREATE TABLE "pricing_distance_tiers" (
    "id" UUID NOT NULL,
    "pricing_config_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "up_to_metres" INTEGER,
    "amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_distance_tiers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pricing_distance_tiers_position_positive_chk" CHECK ("position" >= 1),
    CONSTRAINT "pricing_distance_tiers_up_to_metres_chk" CHECK ("up_to_metres" IS NULL OR "up_to_metres" > 0),
    CONSTRAINT "pricing_distance_tiers_amount_nonnegative_chk" CHECK ("amount" >= 0)
);

CREATE UNIQUE INDEX "pricing_distance_tiers_pricing_config_id_position_key"
    ON "pricing_distance_tiers"("pricing_config_id", "position");

CREATE INDEX "pricing_distance_tiers_pricing_config_id_idx"
    ON "pricing_distance_tiers"("pricing_config_id");

ALTER TABLE "pricing_distance_tiers"
    ADD CONSTRAINT "pricing_distance_tiers_pricing_config_id_fkey"
    FOREIGN KEY ("pricing_config_id") REFERENCES "delivery_pricing_configs"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX "delivery_pricing_configs_one_active_idx";

CREATE UNIQUE INDEX "delivery_pricing_configs_one_active_v1_idx"
    ON "delivery_pricing_configs"("is_active")
    WHERE "is_active" = true AND "service_class" IS NULL;

CREATE UNIQUE INDEX "delivery_pricing_configs_one_active_per_class_idx"
    ON "delivery_pricing_configs"("service_class")
    WHERE "is_active" = true AND "service_class" IS NOT NULL;
