-- A rider can hide one open request from their own list.
-- The delivery, its bids, and every other rider stay unchanged.

CREATE TABLE "rider_request_declines" (
    "id" UUID NOT NULL,
    "rider_profile_id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rider_request_declines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rider_request_declines_rider_profile_id_delivery_id_key"
    ON "rider_request_declines"("rider_profile_id", "delivery_id");

CREATE INDEX "rider_request_declines_delivery_id_idx"
    ON "rider_request_declines"("delivery_id");

ALTER TABLE "rider_request_declines"
    ADD CONSTRAINT "rider_request_declines_rider_profile_id_fkey"
    FOREIGN KEY ("rider_profile_id") REFERENCES "rider_profiles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rider_request_declines"
    ADD CONSTRAINT "rider_request_declines_delivery_id_fkey"
    FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
