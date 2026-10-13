-- Rider motorcycle registration. Many motorcycles per rider, one active
-- verified motorcycle, and a motorcycle id only after an assignment is accepted.
-- This migration does not alter PostGIS catalogs, licence checks, or rider
-- approval and availability checks.
--
-- Prisma 7.1.0 cannot represent the partial unique index, the checks, or the
-- composite foreign key below. Do not drop them in a later migration:
--   motorcycles_identity_chk
--   motorcycles_verification_chk
--   motorcycles_active_requires_verified_chk
--   motorcycles_one_active_per_rider_idx
--   delivery_assignments_motorcycle_owner_fkey
--   delivery_assignments_motorcycle_chk
--
-- Selection locks the rider profile, then that rider's motorcycle rows, and
-- clears the current active row before setting the next one. It does not lock
-- deliveries. Accept still locks the delivery, then the rider profile, then
-- the assignment. After the rider lock it rechecks approval and the single
-- active verified motorcycle, then sets motorcycle_id in the same update that
-- sets ACCEPTED. Offers stay unbound.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "motorcycles") THEN
        RAISE EXCEPTION 'motorcycle colour cannot be added while motorcycle rows exist';
    END IF;
END $$;

ALTER TABLE "motorcycles" ADD COLUMN "colour" VARCHAR(40) NOT NULL;
ALTER TABLE "motorcycles" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "motorcycles" ADD COLUMN "verified_at" TIMESTAMPTZ(6);
ALTER TABLE "motorcycles" ADD COLUMN "verified_by_id" UUID;
ALTER TABLE "motorcycles" ADD COLUMN "rejected_at" TIMESTAMPTZ(6);
ALTER TABLE "motorcycles" ADD COLUMN "rejected_by_id" UUID;
ALTER TABLE "motorcycles" ADD COLUMN "revoked_at" TIMESTAMPTZ(6);
ALTER TABLE "motorcycles" ADD COLUMN "revoked_by_id" UUID;

ALTER TABLE "motorcycles" ADD CONSTRAINT "motorcycles_identity_chk" CHECK (
    "registration_number" = upper("registration_number")
    AND "registration_number" = btrim("registration_number")
    AND char_length("registration_number") > 0
    AND "make" = btrim("make")
    AND char_length("make") > 0
    AND "model" = btrim("model")
    AND char_length("model") > 0
    AND "colour" = btrim("colour")
    AND char_length("colour") > 0
);

-- PENDING and REJECTED were never verified. REVOKED keeps the verification facts.
ALTER TABLE "motorcycles" ADD CONSTRAINT "motorcycles_verification_chk" CHECK (
    (
        "verification_status" = 'PENDING'::"motorcycle_verification_status"
        AND "is_active" = false
        AND "verified_at" IS NULL
        AND "verified_by_id" IS NULL
        AND "rejected_at" IS NULL
        AND "rejected_by_id" IS NULL
        AND "revoked_at" IS NULL
        AND "revoked_by_id" IS NULL
    )
    OR (
        "verification_status" = 'REJECTED'::"motorcycle_verification_status"
        AND "is_active" = false
        AND "verified_at" IS NULL
        AND "verified_by_id" IS NULL
        AND "rejected_at" IS NOT NULL
        AND "rejected_by_id" IS NOT NULL
        AND "revoked_at" IS NULL
        AND "revoked_by_id" IS NULL
    )
    OR (
        "verification_status" = 'VERIFIED'::"motorcycle_verification_status"
        AND "verified_at" IS NOT NULL
        AND "verified_by_id" IS NOT NULL
        AND "rejected_at" IS NULL
        AND "rejected_by_id" IS NULL
        AND "revoked_at" IS NULL
        AND "revoked_by_id" IS NULL
    )
    OR (
        "verification_status" = 'REVOKED'::"motorcycle_verification_status"
        AND "is_active" = false
        AND "verified_at" IS NOT NULL
        AND "verified_by_id" IS NOT NULL
        AND "rejected_at" IS NULL
        AND "rejected_by_id" IS NULL
        AND "revoked_at" IS NOT NULL
        AND "revoked_by_id" IS NOT NULL
    )
);

ALTER TABLE "motorcycles" ADD CONSTRAINT "motorcycles_active_requires_verified_chk" CHECK (
    "is_active" = false OR "verification_status" = 'VERIFIED'::"motorcycle_verification_status"
);

CREATE UNIQUE INDEX "motorcycles_id_rider_profile_id_key" ON "motorcycles" ("id", "rider_profile_id");

CREATE UNIQUE INDEX "motorcycles_one_active_per_rider_idx"
    ON "motorcycles" ("rider_profile_id")
    WHERE "is_active";

ALTER TABLE "motorcycles" ADD CONSTRAINT "motorcycles_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "motorcycles" ADD CONSTRAINT "motorcycles_rejected_by_id_fkey" FOREIGN KEY ("rejected_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "motorcycles" ADD CONSTRAINT "motorcycles_revoked_by_id_fkey" FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Do not invent a motorcycle for assignments that already passed acceptance.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "delivery_assignments"
        WHERE "status" IN ('ACCEPTED', 'RELEASED', 'COMPLETED', 'FAILED')
    ) THEN
        RAISE EXCEPTION 'accepted delivery assignments exist without a motorcycle';
    END IF;
END $$;

ALTER TABLE "delivery_assignments" ADD COLUMN "motorcycle_id" UUID;

-- OFFERED, REJECTED, EXPIRED, and CANCELLED never reached ACCEPTED.
-- RELEASED, COMPLETED, and FAILED are reached only from ACCEPTED.
ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_motorcycle_chk" CHECK (
    (
        "status" IN ('OFFERED', 'REJECTED', 'EXPIRED', 'CANCELLED')
        AND "motorcycle_id" IS NULL
    )
    OR (
        "status" IN ('ACCEPTED', 'RELEASED', 'COMPLETED', 'FAILED')
        AND "motorcycle_id" IS NOT NULL
    )
);

ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_motorcycle_owner_fkey"
    FOREIGN KEY ("motorcycle_id", "rider_profile_id")
    REFERENCES "motorcycles" ("id", "rider_profile_id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

CREATE INDEX "delivery_assignments_motorcycle_id_idx" ON "delivery_assignments" ("motorcycle_id");
