-- Phase 1 foundation only. V1 dispatch, wallets, and offer acceptance are unchanged.
-- Prisma cannot represent the credential check or the bid partial indexes.
-- Do not drop these in a later generated migration:
--   users_account_credential_chk
--   bids_one_open_per_rider_delivery_idx
--   bids_one_accepted_per_delivery_idx
--   delivery_assignments_one_accepted_per_rider_idx
--   delivery_assignments_one_accepted_per_delivery_idx
--   refresh_sessions_one_active_per_family_idx

ALTER TABLE "users" DROP CONSTRAINT "users_passwordless_account_chk";

-- An active rider or customer needs either a password or a verified phone.
-- Existing OTP accounts keep a null password hash and a verified phone.
-- Admins stay outside this check.
ALTER TABLE "users" ADD CONSTRAINT "users_account_credential_chk" CHECK (
    (
        "role" IN ('CUSTOMER'::"user_role", 'RIDER'::"user_role")
        AND (
            (
                "password_hash" IS NULL
                AND (
                    "account_status" <> 'ACTIVE'::"account_status"
                    OR "phone_verified_at" IS NOT NULL
                )
            )
            OR "password_hash" IS NOT NULL
        )
    )
    OR "role" = 'ADMIN'::"user_role"
);

ALTER TABLE "rider_profiles" ADD COLUMN "receiving_requests" BOOLEAN;

CREATE TYPE "service_class" AS ENUM ('EXPRESS', 'FLEXIBLE');

ALTER TABLE "deliveries" ADD COLUMN "service_class" "service_class";
ALTER TABLE "deliveries" ADD COLUMN "deliver_by" TIMESTAMPTZ(6);

CREATE TYPE "bid_status" AS ENUM ('OPEN', 'WITHDRAWN', 'ACCEPTED', 'SUPERSEDED', 'EXPIRED');

CREATE TABLE "bids" (
    "id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "rider_profile_id" UUID NOT NULL,
    "amount" DECIMAL(12, 2) NOT NULL,
    "currency" "currency" NOT NULL DEFAULT 'USD',
    "status" "bid_status" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bids_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bids_delivery_id_status_idx" ON "bids"("delivery_id", "status");
CREATE INDEX "bids_rider_profile_id_status_idx" ON "bids"("rider_profile_id", "status");

CREATE UNIQUE INDEX "bids_one_open_per_rider_delivery_idx"
    ON "bids" ("delivery_id", "rider_profile_id")
    WHERE "status" = 'OPEN';

CREATE UNIQUE INDEX "bids_one_accepted_per_delivery_idx"
    ON "bids" ("delivery_id")
    WHERE "status" = 'ACCEPTED';

ALTER TABLE "bids" ADD CONSTRAINT "bids_delivery_id_fkey"
    FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bids" ADD CONSTRAINT "bids_rider_profile_id_fkey"
    FOREIGN KEY ("rider_profile_id") REFERENCES "rider_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TYPE "pricing_window_kind" AS ENUM ('PEAK', 'OFF_PEAK', 'NIGHT');

CREATE TABLE "pricing_windows" (
    "id" UUID NOT NULL,
    "pricing_config_id" UUID NOT NULL,
    "kind" "pricing_window_kind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "days_of_week" INTEGER[] NOT NULL,
    "starts_at" VARCHAR(5) NOT NULL,
    "ends_at" VARCHAR(5) NOT NULL,
    "adjustment_basis_points" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_windows_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pricing_windows_pricing_config_id_idx" ON "pricing_windows"("pricing_config_id");

ALTER TABLE "pricing_windows" ADD CONSTRAINT "pricing_windows_pricing_config_id_fkey"
    FOREIGN KEY ("pricing_config_id") REFERENCES "delivery_pricing_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "pricing_config_audits" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "previous_version" INTEGER,
    "next_version" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_config_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pricing_config_audits_actor_id_idx" ON "pricing_config_audits"("actor_id");

ALTER TABLE "pricing_config_audits" ADD CONSTRAINT "pricing_config_audits_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "password_login_attempts" (
    "id" UUID NOT NULL,
    "ip_hash" CHAR(64) NOT NULL,
    "phone_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_login_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "password_login_attempts_ip_hash_created_at_idx"
    ON "password_login_attempts"("ip_hash", "created_at");
CREATE INDEX "password_login_attempts_phone_hash_created_at_idx"
    ON "password_login_attempts"("phone_hash", "created_at");
