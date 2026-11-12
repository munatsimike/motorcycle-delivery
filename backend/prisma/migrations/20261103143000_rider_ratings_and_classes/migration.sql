-- Customer star ratings, denormalized rider stats, and bid dismissals.
-- Do not drop rider_ratings_stars_chk or rider_profiles_rating_counts_chk.

CREATE TYPE "rider_class" AS ENUM ('SILVER', 'GOLD', 'PLATINUM');

ALTER TABLE "rider_profiles"
    ADD COLUMN "completed_delivery_count" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "rating_count" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "rating_sum" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "rider_class" "rider_class" NOT NULL DEFAULT 'SILVER';

ALTER TABLE "rider_profiles"
    ADD CONSTRAINT "rider_profiles_rating_counts_chk"
    CHECK (
        "completed_delivery_count" >= 0
        AND "rating_count" >= 0
        AND "rating_sum" >= 0
        AND "rating_sum" >= "rating_count"
    );

ALTER TABLE "bids"
    ADD COLUMN "customer_dismissed_at" TIMESTAMPTZ(6);

CREATE TABLE "rider_ratings" (
    "id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "rider_profile_id" UUID NOT NULL,
    "customer_account_id" UUID NOT NULL,
    "stars" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rider_ratings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "rider_ratings"
    ADD CONSTRAINT "rider_ratings_stars_chk"
    CHECK ("stars" >= 1 AND "stars" <= 5);

ALTER TABLE "rider_ratings"
    ADD CONSTRAINT "rider_ratings_delivery_id_key" UNIQUE ("delivery_id");

ALTER TABLE "rider_ratings"
    ADD CONSTRAINT "rider_ratings_delivery_id_fkey"
    FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rider_ratings"
    ADD CONSTRAINT "rider_ratings_rider_profile_id_fkey"
    FOREIGN KEY ("rider_profile_id") REFERENCES "rider_profiles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rider_ratings"
    ADD CONSTRAINT "rider_ratings_customer_account_id_fkey"
    FOREIGN KEY ("customer_account_id") REFERENCES "customer_accounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "rider_ratings_rider_profile_id_idx"
    ON "rider_ratings"("rider_profile_id");

CREATE INDEX "rider_ratings_customer_account_id_idx"
    ON "rider_ratings"("customer_account_id");

UPDATE "rider_profiles" AS profile
SET "completed_delivery_count" = counted.completed
FROM (
    SELECT
        assignment."rider_profile_id" AS rider_profile_id,
        COUNT(*)::INTEGER AS completed
    FROM "delivery_assignments" AS assignment
    INNER JOIN "deliveries" AS delivery
        ON delivery."id" = assignment."delivery_id"
    WHERE delivery."status" = 'DELIVERED'::"delivery_status"
      AND assignment."status" IN (
          'ACCEPTED'::"assignment_status",
          'COMPLETED'::"assignment_status"
      )
    GROUP BY assignment."rider_profile_id"
) AS counted
WHERE profile."id" = counted.rider_profile_id;
