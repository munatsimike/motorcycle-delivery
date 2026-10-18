-- Lets the retention pass remember one failed refresh without moving the
-- retrieval clock, and claims a single lock row so two processes do not
-- delete coordinates at once. Existing coordinates are not updated.

ALTER TABLE "deliveries"
    ADD COLUMN "pickup_coordinate_refresh_attempted_at" TIMESTAMPTZ(6),
    ADD COLUMN "dropoff_coordinate_refresh_attempted_at" TIMESTAMPTZ(6);

CREATE TABLE "coordinate_retention_lock" (
    "id" INTEGER NOT NULL,
    "locked_until" TIMESTAMPTZ(6),
    "owner" UUID,
    CONSTRAINT "coordinate_retention_lock_pkey" PRIMARY KEY ("id")
);

INSERT INTO "coordinate_retention_lock" ("id", "locked_until", "owner") VALUES (1, NULL, NULL);
