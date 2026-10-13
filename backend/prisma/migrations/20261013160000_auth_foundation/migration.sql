-- Passwordless rider authentication.
-- This migration does not alter PostGIS catalogs or delivery tables.
--
-- Prisma 7.1.0 cannot represent the partial unique index or the passwordless
-- check below. Do not drop them in a later migration:
--   refresh_sessions_one_active_per_family_idx
--   users_passwordless_account_chk

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN "phone_verified_at" TIMESTAMPTZ(6);

-- Riders and customers never store a password. An ACTIVE rider or customer
-- must have a verified phone. Admins are outside this check.
ALTER TABLE "users" ADD CONSTRAINT "users_passwordless_account_chk" CHECK (
    (
        "role" IN ('CUSTOMER'::"user_role", 'RIDER'::"user_role")
        AND "password_hash" IS NULL
        AND (
            "account_status" <> 'ACTIVE'::"account_status"
            OR "phone_verified_at" IS NOT NULL
        )
    )
    OR "role" = 'ADMIN'::"user_role"
);

-- CreateEnum
CREATE TYPE "auth_subject_role" AS ENUM ('RIDER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "auth_purpose" AS ENUM ('REGISTRATION', 'LOGIN');

-- CreateEnum
CREATE TYPE "auth_challenge_status" AS ENUM ('PENDING', 'VERIFIED', 'EXPIRED', 'LOCKED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "auth_challenges" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "subject_role" "auth_subject_role" NOT NULL,
    "purpose" "auth_purpose" NOT NULL,
    "full_name" VARCHAR(200),
    "twilio_sid" VARCHAR(64),
    "status" "auth_challenge_status" NOT NULL DEFAULT 'PENDING',
    "send_count" INTEGER NOT NULL DEFAULT 1,
    "check_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "ip_hash" CHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "family_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "replaced_by_session_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_challenges_phone_subject_role_purpose_created_at_idx" ON "auth_challenges"("phone", "subject_role", "purpose", "created_at");

-- CreateIndex
CREATE INDEX "auth_challenges_ip_hash_created_at_idx" ON "auth_challenges"("ip_hash", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_token_hash_key" ON "refresh_sessions"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_replaced_by_session_id_key" ON "refresh_sessions"("replaced_by_session_id");

-- CreateIndex
CREATE INDEX "refresh_sessions_user_id_revoked_at_idx" ON "refresh_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "refresh_sessions_family_id_idx" ON "refresh_sessions"("family_id");

-- One unrevoked, unreplaced session per family. Rotation revokes the previous
-- row in the same transaction before inserting its replacement.
CREATE UNIQUE INDEX "refresh_sessions_one_active_per_family_idx"
    ON "refresh_sessions" ("family_id")
    WHERE "revoked_at" IS NULL AND "replaced_by_session_id" IS NULL;

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_replaced_by_session_id_fkey" FOREIGN KEY ("replaced_by_session_id") REFERENCES "refresh_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Zimbabwean driver's licences have no expiry date. Phone verification can
-- create a rider profile before an admin records the licence. Licence
-- verification stays separate from rider approval and from motorcycle
-- verification. rider_profiles_availability_requires_approval_chk is unchanged.
ALTER TABLE "rider_profiles" DROP COLUMN "licence_expires_on";

ALTER TABLE "rider_profiles" ALTER COLUMN "licence_number" DROP NOT NULL;

ALTER TABLE "rider_profiles" ADD COLUMN "licence_class" VARCHAR(40);

ALTER TABLE "rider_profiles" ADD COLUMN "verified_at" TIMESTAMPTZ(6);

ALTER TABLE "rider_profiles" ADD COLUMN "reviewer_id" UUID;

CREATE INDEX "rider_profiles_reviewer_id_idx" ON "rider_profiles"("reviewer_id");

ALTER TABLE "rider_profiles" ADD CONSTRAINT "rider_profiles_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PENDING has no recorded licence facts yet. VERIFIED requires the number,
-- class, verification time, and reviewer. A missing expiry is never a failure.
-- REJECTED may record the reviewer without a verification date.
ALTER TABLE "rider_profiles" ADD CONSTRAINT "rider_profiles_licence_verification_chk" CHECK (
    (
        "verification_status" = 'PENDING'::"rider_verification_status"
        AND "licence_number" IS NULL
        AND "licence_class" IS NULL
        AND "verified_at" IS NULL
        AND "reviewer_id" IS NULL
    )
    OR (
        "verification_status" = 'VERIFIED'::"rider_verification_status"
        AND "licence_number" IS NOT NULL
        AND btrim("licence_number") <> ''
        AND "licence_class" IS NOT NULL
        AND btrim("licence_class") <> ''
        AND "verified_at" IS NOT NULL
        AND "reviewer_id" IS NOT NULL
    )
    OR (
        "verification_status" = 'REJECTED'::"rider_verification_status"
        AND "licence_number" IS NULL
        AND "licence_class" IS NULL
        AND "verified_at" IS NULL
    )
);
