-- Phase 4A licence review history. Decisions are append-only. The current
-- licence snapshot stays on rider_profiles and must still satisfy
-- rider_profiles_licence_verification_chk.
--
-- This migration does not alter applied migrations, PostGIS catalogs,
-- delivery_assignments, or delivery_assignments_motorcycle_owner_fkey.
--
-- Prisma 7.1.0 cannot represent the composite foreign key or the trigger
-- below. prisma migrate diff may propose dropping
-- rider_licence_reviews_image_owner_fkey. Remove that DROP CONSTRAINT
-- statement before applying a later generated migration. Do not drop
-- rider_licence_reviews_append_only either. The trigger only rejects
-- UPDATE and DELETE. It does not implement review workflow.
--   rider_licence_reviews_decision_chk
--   rider_licence_reviews_image_owner_fkey
--   rider_licence_reviews_append_only

CREATE TYPE "licence_review_decision" AS ENUM ('VERIFY', 'REJECT');

ALTER TABLE "rider_licence_images"
    ADD CONSTRAINT "rider_licence_images_id_rider_profile_id_key"
    UNIQUE ("id", "rider_profile_id");

CREATE TABLE "rider_licence_reviews" (
    "id" UUID NOT NULL,
    "rider_profile_id" UUID NOT NULL,
    "licence_image_id" UUID NOT NULL,
    "decision" "licence_review_decision" NOT NULL,
    "licence_number" VARCHAR(50),
    "licence_class" VARCHAR(40),
    "rejection_reason" VARCHAR(500),
    "reviewer_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rider_licence_reviews_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "rider_licence_reviews" ADD CONSTRAINT "rider_licence_reviews_decision_chk" CHECK (
    (
        "decision" = 'VERIFY'::"licence_review_decision"
        AND "licence_number" IS NOT NULL
        AND btrim("licence_number") <> ''
        AND "licence_class" IS NOT NULL
        AND btrim("licence_class") <> ''
        AND "rejection_reason" IS NULL
    )
    OR (
        "decision" = 'REJECT'::"licence_review_decision"
        AND "rejection_reason" IS NOT NULL
        AND btrim("rejection_reason") <> ''
        AND "licence_number" IS NULL
        AND "licence_class" IS NULL
    )
);

ALTER TABLE "rider_licence_reviews"
    ADD CONSTRAINT "rider_licence_reviews_rider_profile_id_fkey"
    FOREIGN KEY ("rider_profile_id") REFERENCES "rider_profiles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rider_licence_reviews"
    ADD CONSTRAINT "rider_licence_reviews_licence_image_id_fkey"
    FOREIGN KEY ("licence_image_id") REFERENCES "rider_licence_images"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Same rider as the image. Prisma cannot model this while rider_profile_id
-- is already the profile relation. Do not drop this constraint.
ALTER TABLE "rider_licence_reviews"
    ADD CONSTRAINT "rider_licence_reviews_image_owner_fkey"
    FOREIGN KEY ("licence_image_id", "rider_profile_id")
    REFERENCES "rider_licence_images"("id", "rider_profile_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rider_licence_reviews"
    ADD CONSTRAINT "rider_licence_reviews_reviewer_id_fkey"
    FOREIGN KEY ("reviewer_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "rider_licence_reviews_rider_profile_id_created_at_idx"
    ON "rider_licence_reviews"("rider_profile_id", "created_at");

CREATE INDEX "rider_licence_reviews_licence_image_id_idx"
    ON "rider_licence_reviews"("licence_image_id");

CREATE INDEX "rider_licence_reviews_reviewer_id_idx"
    ON "rider_licence_reviews"("reviewer_id");

CREATE FUNCTION "rider_licence_reviews_reject_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'rider licence reviews are append-only';
END;
$$;

CREATE TRIGGER "rider_licence_reviews_append_only"
    BEFORE UPDATE OR DELETE ON "rider_licence_reviews"
    FOR EACH ROW
    EXECUTE FUNCTION "rider_licence_reviews_reject_mutation"();
