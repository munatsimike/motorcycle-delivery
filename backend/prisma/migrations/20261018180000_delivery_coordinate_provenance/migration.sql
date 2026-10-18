-- Records which provider produced each delivery coordinate.
-- Existing coordinate values are left unchanged.
-- Rows already stored are UNREVIEWED because the table did not record a provider.
-- UNREVIEWED is not an exemption from a later Google retention job.

CREATE TYPE "coordinate_source" AS ENUM (
    'GOOGLE_PLACES',
    'DEVICE_GEOCODER',
    'UNREVIEWED'
);

ALTER TABLE "deliveries"
    ADD COLUMN "pickup_place_id" VARCHAR(255),
    ADD COLUMN "dropoff_place_id" VARCHAR(255),
    ADD COLUMN "pickup_coordinate_source" "coordinate_source" NOT NULL DEFAULT 'UNREVIEWED',
    ADD COLUMN "dropoff_coordinate_source" "coordinate_source" NOT NULL DEFAULT 'UNREVIEWED',
    ADD COLUMN "pickup_coordinate_retrieved_at" TIMESTAMPTZ(6),
    ADD COLUMN "dropoff_coordinate_retrieved_at" TIMESTAMPTZ(6);

ALTER TABLE "deliveries" ALTER COLUMN "pickup_coordinate_source" DROP DEFAULT;
ALTER TABLE "deliveries" ALTER COLUMN "dropoff_coordinate_source" DROP DEFAULT;

ALTER TABLE "deliveries" ALTER COLUMN "pickup_latitude" DROP NOT NULL;
ALTER TABLE "deliveries" ALTER COLUMN "pickup_longitude" DROP NOT NULL;
ALTER TABLE "deliveries" ALTER COLUMN "dropoff_latitude" DROP NOT NULL;
ALTER TABLE "deliveries" ALTER COLUMN "dropoff_longitude" DROP NOT NULL;

ALTER TABLE "deliveries"
    ADD CONSTRAINT "deliveries_pickup_coordinate_provenance_chk"
    CHECK (
        (
            "pickup_coordinate_source" = 'GOOGLE_PLACES'
            AND "pickup_place_id" IS NOT NULL
            AND char_length("pickup_place_id") BETWEEN 8 AND 255
            AND "pickup_coordinate_retrieved_at" IS NOT NULL
            AND ("pickup_latitude" IS NULL) = ("pickup_longitude" IS NULL)
        )
        OR (
            "pickup_coordinate_source" = 'DEVICE_GEOCODER'
            AND "pickup_place_id" IS NULL
            AND "pickup_coordinate_retrieved_at" IS NOT NULL
            AND "pickup_latitude" IS NOT NULL
            AND "pickup_longitude" IS NOT NULL
        )
        OR (
            "pickup_coordinate_source" = 'UNREVIEWED'
            AND "pickup_place_id" IS NULL
            AND "pickup_coordinate_retrieved_at" IS NULL
            AND ("pickup_latitude" IS NULL) = ("pickup_longitude" IS NULL)
        )
    );

ALTER TABLE "deliveries"
    ADD CONSTRAINT "deliveries_dropoff_coordinate_provenance_chk"
    CHECK (
        (
            "dropoff_coordinate_source" = 'GOOGLE_PLACES'
            AND "dropoff_place_id" IS NOT NULL
            AND char_length("dropoff_place_id") BETWEEN 8 AND 255
            AND "dropoff_coordinate_retrieved_at" IS NOT NULL
            AND ("dropoff_latitude" IS NULL) = ("dropoff_longitude" IS NULL)
        )
        OR (
            "dropoff_coordinate_source" = 'DEVICE_GEOCODER'
            AND "dropoff_place_id" IS NULL
            AND "dropoff_coordinate_retrieved_at" IS NOT NULL
            AND "dropoff_latitude" IS NOT NULL
            AND "dropoff_longitude" IS NOT NULL
        )
        OR (
            "dropoff_coordinate_source" = 'UNREVIEWED'
            AND "dropoff_place_id" IS NULL
            AND "dropoff_coordinate_retrieved_at" IS NULL
            AND ("dropoff_latitude" IS NULL) = ("dropoff_longitude" IS NULL)
        )
    );
