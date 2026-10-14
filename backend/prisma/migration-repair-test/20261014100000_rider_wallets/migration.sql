-- Phase 6A rider wallets. Seeds wallet configuration version 1 and one
-- zero-balance wallet per existing rider. APPROVED and SUSPENDED riders are
-- marked as having used the welcome-bonus entitlement. This file does not
-- insert a credit, change rider approval, or edit delivery prices.
--
-- A later reversal is a new compensating rider_wallet_entries row. Do not
-- update or delete historical wallet rows. Do not drop the existing delivery
-- or licence constraints.

CREATE TYPE "wallet_entry_type" AS ENUM (
    'WELCOME_BONUS',
    'TOP_UP',
    'PROMOTIONAL_CREDIT',
    'ADJUSTMENT',
    'PLATFORM_FEE_HOLD',
    'PLATFORM_FEE',
    'PLATFORM_FEE_RELEASE'
);

CREATE TYPE "wallet_payment_method" AS ENUM ('CASH', 'ECOCASH', 'GATEWAY');

CREATE TYPE "wallet_payment_status" AS ENUM ('PENDING', 'FAILED', 'VERIFIED');

CREATE TYPE "wallet_top_up_request_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TYPE "wallet_fee_reservation_status" AS ENUM ('OPEN', 'RELEASED', 'CAPTURED');

CREATE TYPE "wallet_actor_type" AS ENUM ('ADMIN', 'RIDER', 'SYSTEM');

CREATE TABLE "wallet_configs" (
    "id" UUID NOT NULL,
    "config_version" INTEGER NOT NULL,
    "currency" "currency" NOT NULL,
    "welcome_bonus" DECIMAL(12,2) NOT NULL,
    "default_borrowing_limit" DECIMAL(12,2) NOT NULL,
    "platform_fee" DECIMAL(12,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,

    CONSTRAINT "wallet_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wallet_configs_config_version_key"
    ON "wallet_configs"("config_version");

CREATE INDEX "wallet_configs_created_by_id_idx"
    ON "wallet_configs"("created_by_id");

CREATE UNIQUE INDEX "wallet_configs_one_active_idx"
    ON "wallet_configs"("is_active")
    WHERE "is_active" = true;

ALTER TABLE "wallet_configs"
    ADD CONSTRAINT "wallet_configs_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wallet_configs"
    ADD CONSTRAINT "wallet_configs_usd_chk"
    CHECK ("currency" = 'USD'::"currency");

ALTER TABLE "wallet_configs"
    ADD CONSTRAINT "wallet_configs_amount_chk"
    CHECK (
        "config_version" >= 1
        AND "welcome_bonus" >= 0
        AND "default_borrowing_limit" >= 0
        AND "platform_fee" >= 0
    );

CREATE TABLE "wallet_config_audits" (
    "id" UUID NOT NULL,
    "config_version" INTEGER NOT NULL,
    "actor_type" "wallet_actor_type" NOT NULL,
    "actor_id" UUID,
    "previous_welcome_bonus" DECIMAL(12,2),
    "previous_default_borrowing_limit" DECIMAL(12,2),
    "previous_platform_fee" DECIMAL(12,2),
    "new_welcome_bonus" DECIMAL(12,2) NOT NULL,
    "new_default_borrowing_limit" DECIMAL(12,2) NOT NULL,
    "new_platform_fee" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_config_audits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wallet_config_audits_config_version_key"
    ON "wallet_config_audits"("config_version");

CREATE INDEX "wallet_config_audits_actor_id_idx"
    ON "wallet_config_audits"("actor_id");

ALTER TABLE "wallet_config_audits"
    ADD CONSTRAINT "wallet_config_audits_config_version_fkey"
    FOREIGN KEY ("config_version") REFERENCES "wallet_configs"("config_version")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wallet_config_audits"
    ADD CONSTRAINT "wallet_config_audits_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wallet_config_audits"
    ADD CONSTRAINT "wallet_config_audits_actor_chk"
    CHECK (
        ("actor_type" = 'SYSTEM'::"wallet_actor_type" AND "actor_id" IS NULL)
        OR ("actor_type" = 'ADMIN'::"wallet_actor_type" AND "actor_id" IS NOT NULL)
    );

ALTER TABLE "wallet_config_audits"
    ADD CONSTRAINT "wallet_config_audits_values_chk"
    CHECK (
        "new_welcome_bonus" >= 0
        AND "new_default_borrowing_limit" >= 0
        AND "new_platform_fee" >= 0
        AND (
            "previous_welcome_bonus" IS NULL
            OR "previous_welcome_bonus" >= 0
        )
        AND (
            "previous_default_borrowing_limit" IS NULL
            OR "previous_default_borrowing_limit" >= 0
        )
        AND (
            "previous_platform_fee" IS NULL
            OR "previous_platform_fee" >= 0
        )
        AND (
            (
                "config_version" = 1
                AND "previous_welcome_bonus" IS NULL
                AND "previous_default_borrowing_limit" IS NULL
                AND "previous_platform_fee" IS NULL
            )
            OR (
                "config_version" > 1
                AND "previous_welcome_bonus" IS NOT NULL
                AND "previous_default_borrowing_limit" IS NOT NULL
                AND "previous_platform_fee" IS NOT NULL
            )
        )
    );

CREATE TABLE "rider_wallets" (
    "id" UUID NOT NULL,
    "rider_profile_id" UUID NOT NULL,
    "currency" "currency" NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL,
    "borrowing_limit_override" DECIMAL(12,2),
    "welcome_bonus_awarded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rider_wallets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rider_wallets_rider_profile_id_key"
    ON "rider_wallets"("rider_profile_id");

ALTER TABLE "rider_wallets"
    ADD CONSTRAINT "rider_wallets_rider_profile_id_fkey"
    FOREIGN KEY ("rider_profile_id") REFERENCES "rider_profiles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rider_wallets"
    ADD CONSTRAINT "rider_wallets_usd_chk"
    CHECK ("currency" = 'USD'::"currency");

ALTER TABLE "rider_wallets"
    ADD CONSTRAINT "rider_wallets_override_chk"
    CHECK (
        "borrowing_limit_override" IS NULL
        OR "borrowing_limit_override" >= 0
    );

CREATE TABLE "wallet_top_up_requests" (
    "id" UUID NOT NULL,
    "rider_wallet_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "wallet_payment_method" NOT NULL,
    "ecocash_reference" VARCHAR(64),
    "status" "wallet_top_up_request_status" NOT NULL DEFAULT 'PENDING',
    "rejection_reason" VARCHAR(500),
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_top_up_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "wallet_top_up_requests_rider_wallet_id_status_created_at_idx"
    ON "wallet_top_up_requests"("rider_wallet_id", "status", "created_at");

CREATE INDEX "wallet_top_up_requests_reviewed_by_id_idx"
    ON "wallet_top_up_requests"("reviewed_by_id");

ALTER TABLE "wallet_top_up_requests"
    ADD CONSTRAINT "wallet_top_up_requests_rider_wallet_id_fkey"
    FOREIGN KEY ("rider_wallet_id") REFERENCES "rider_wallets"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wallet_top_up_requests"
    ADD CONSTRAINT "wallet_top_up_requests_reviewed_by_id_fkey"
    FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wallet_top_up_requests"
    ADD CONSTRAINT "wallet_top_up_requests_shape_chk"
    CHECK (
        "amount" > 0
        AND "method" IN (
            'CASH'::"wallet_payment_method",
            'ECOCASH'::"wallet_payment_method"
        )
        AND (
            (
                "method" = 'CASH'::"wallet_payment_method"
                AND "ecocash_reference" IS NULL
            )
            OR (
                "method" = 'ECOCASH'::"wallet_payment_method"
                AND "ecocash_reference" IS NOT NULL
                AND btrim("ecocash_reference") <> ''
            )
        )
        AND (
            (
                "status" = 'PENDING'::"wallet_top_up_request_status"
                AND "reviewed_by_id" IS NULL
                AND "reviewed_at" IS NULL
                AND "rejection_reason" IS NULL
            )
            OR (
                "status" = 'APPROVED'::"wallet_top_up_request_status"
                AND "reviewed_by_id" IS NOT NULL
                AND "reviewed_at" IS NOT NULL
                AND "rejection_reason" IS NULL
            )
            OR (
                "status" = 'REJECTED'::"wallet_top_up_request_status"
                AND "reviewed_by_id" IS NOT NULL
                AND "reviewed_at" IS NOT NULL
                AND "rejection_reason" IS NOT NULL
                AND btrim("rejection_reason") <> ''
            )
        )
    );

CREATE TABLE "wallet_payments" (
    "id" UUID NOT NULL,
    "rider_wallet_id" UUID NOT NULL,
    "method" "wallet_payment_method" NOT NULL,
    "status" "wallet_payment_status" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" "currency" NOT NULL,
    "internal_receipt_id" VARCHAR(40),
    "external_receipt_number" VARCHAR(64),
    "ecocash_reference" VARCHAR(64),
    "provider" VARCHAR(40),
    "provider_transaction_id" VARCHAR(120),
    "idempotency_key" VARCHAR(200) NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "top_up_request_id" UUID,
    "confirmed_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_at" TIMESTAMPTZ(6),

    CONSTRAINT "wallet_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wallet_payments_internal_receipt_id_key"
    ON "wallet_payments"("internal_receipt_id");

CREATE UNIQUE INDEX "wallet_payments_external_receipt_number_key"
    ON "wallet_payments"("external_receipt_number");

CREATE UNIQUE INDEX "wallet_payments_ecocash_reference_key"
    ON "wallet_payments"("ecocash_reference");

CREATE UNIQUE INDEX "wallet_payments_idempotency_key_key"
    ON "wallet_payments"("idempotency_key");

CREATE UNIQUE INDEX "wallet_payments_top_up_request_id_key"
    ON "wallet_payments"("top_up_request_id");

CREATE UNIQUE INDEX "wallet_payments_provider_provider_transaction_id_key"
    ON "wallet_payments"("provider", "provider_transaction_id");

CREATE INDEX "wallet_payments_rider_wallet_id_created_at_idx"
    ON "wallet_payments"("rider_wallet_id", "created_at");

CREATE INDEX "wallet_payments_confirmed_by_id_idx"
    ON "wallet_payments"("confirmed_by_id");

ALTER TABLE "wallet_payments"
    ADD CONSTRAINT "wallet_payments_rider_wallet_id_fkey"
    FOREIGN KEY ("rider_wallet_id") REFERENCES "rider_wallets"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wallet_payments"
    ADD CONSTRAINT "wallet_payments_top_up_request_id_fkey"
    FOREIGN KEY ("top_up_request_id") REFERENCES "wallet_top_up_requests"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wallet_payments"
    ADD CONSTRAINT "wallet_payments_confirmed_by_id_fkey"
    FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wallet_payments"
    ADD CONSTRAINT "wallet_payments_shape_chk"
    CHECK (
        "amount" > 0
        AND "currency" = 'USD'::"currency"
        AND btrim("idempotency_key") <> ''
        AND "payload_hash" ~ '^[0-9a-f]{64}$'
        AND (
            (
                "method" = 'CASH'::"wallet_payment_method"
                AND "internal_receipt_id" IS NOT NULL
                AND btrim("internal_receipt_id") <> ''
                AND "ecocash_reference" IS NULL
                AND "provider" IS NULL
                AND "provider_transaction_id" IS NULL
            )
            OR (
                "method" = 'ECOCASH'::"wallet_payment_method"
                AND "ecocash_reference" IS NOT NULL
                AND btrim("ecocash_reference") <> ''
                AND "internal_receipt_id" IS NULL
                AND "external_receipt_number" IS NULL
                AND "provider" IS NULL
                AND "provider_transaction_id" IS NULL
            )
            OR (
                "method" = 'GATEWAY'::"wallet_payment_method"
                AND "provider" IS NOT NULL
                AND btrim("provider") <> ''
                AND "provider_transaction_id" IS NOT NULL
                AND btrim("provider_transaction_id") <> ''
                AND "internal_receipt_id" IS NULL
                AND "external_receipt_number" IS NULL
                AND "ecocash_reference" IS NULL
            )
        )
        AND (
            "external_receipt_number" IS NULL
            OR (
                "method" = 'CASH'::"wallet_payment_method"
                AND btrim("external_receipt_number") <> ''
            )
        )
        AND (
            (
                "status" = 'VERIFIED'::"wallet_payment_status"
                AND "verified_at" IS NOT NULL
                AND (
                    "method" = 'GATEWAY'::"wallet_payment_method"
                    OR "confirmed_by_id" IS NOT NULL
                )
            )
            OR (
                "status" IN (
                    'PENDING'::"wallet_payment_status",
                    'FAILED'::"wallet_payment_status"
                )
                AND "verified_at" IS NULL
            )
        )
    );

CREATE TABLE "rider_wallet_entries" (
    "id" UUID NOT NULL,
    "rider_wallet_id" UUID NOT NULL,
    "entry_type" "wallet_entry_type" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balance_after" DECIMAL(12,2) NOT NULL,
    "currency" "currency" NOT NULL,
    "config_version" INTEGER NOT NULL,
    "idempotency_key" VARCHAR(200) NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "wallet_payment_id" UUID,
    "reason" VARCHAR(500),
    "actor_type" "wallet_actor_type" NOT NULL,
    "actor_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rider_wallet_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rider_wallet_entries_idempotency_key_key"
    ON "rider_wallet_entries"("idempotency_key");

CREATE UNIQUE INDEX "rider_wallet_entries_wallet_payment_id_key"
    ON "rider_wallet_entries"("wallet_payment_id");

CREATE UNIQUE INDEX "rider_wallet_entries_one_welcome_bonus_idx"
    ON "rider_wallet_entries"("rider_wallet_id")
    WHERE "entry_type" = 'WELCOME_BONUS'::"wallet_entry_type";

CREATE INDEX "rider_wallet_entries_rider_wallet_id_created_at_idx"
    ON "rider_wallet_entries"("rider_wallet_id", "created_at");

CREATE INDEX "rider_wallet_entries_actor_id_idx"
    ON "rider_wallet_entries"("actor_id");

ALTER TABLE "rider_wallet_entries"
    ADD CONSTRAINT "rider_wallet_entries_rider_wallet_id_fkey"
    FOREIGN KEY ("rider_wallet_id") REFERENCES "rider_wallets"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rider_wallet_entries"
    ADD CONSTRAINT "rider_wallet_entries_wallet_payment_id_fkey"
    FOREIGN KEY ("wallet_payment_id") REFERENCES "wallet_payments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rider_wallet_entries"
    ADD CONSTRAINT "rider_wallet_entries_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rider_wallet_entries"
    ADD CONSTRAINT "rider_wallet_entries_shape_chk"
    CHECK (
        "currency" = 'USD'::"currency"
        AND "config_version" >= 1
        AND btrim("idempotency_key") <> ''
        AND "payload_hash" ~ '^[0-9a-f]{64}$'
        AND (
            ("actor_type" = 'SYSTEM'::"wallet_actor_type" AND "actor_id" IS NULL)
            OR (
                "actor_type" IN (
                    'ADMIN'::"wallet_actor_type",
                    'RIDER'::"wallet_actor_type"
                )
                AND "actor_id" IS NOT NULL
            )
        )
        AND (
            (
                "entry_type" = 'WELCOME_BONUS'::"wallet_entry_type"
                AND "amount" >= 0
                AND "wallet_payment_id" IS NULL
            )
            OR (
                "entry_type" = 'TOP_UP'::"wallet_entry_type"
                AND "amount" > 0
                AND "wallet_payment_id" IS NOT NULL
            )
            OR (
                "entry_type" = 'PROMOTIONAL_CREDIT'::"wallet_entry_type"
                AND "amount" > 0
                AND "wallet_payment_id" IS NULL
                AND "reason" IS NOT NULL
                AND btrim("reason") <> ''
            )
            OR (
                "entry_type" = 'ADJUSTMENT'::"wallet_entry_type"
                AND "amount" <> 0
                AND "wallet_payment_id" IS NULL
                AND "reason" IS NOT NULL
                AND btrim("reason") <> ''
            )
            OR (
                "entry_type" = 'PLATFORM_FEE_HOLD'::"wallet_entry_type"
                AND "amount" < 0
                AND "wallet_payment_id" IS NULL
            )
            OR (
                "entry_type" = 'PLATFORM_FEE'::"wallet_entry_type"
                AND "amount" < 0
                AND "wallet_payment_id" IS NULL
            )
            OR (
                "entry_type" = 'PLATFORM_FEE_RELEASE'::"wallet_entry_type"
                AND "amount" > 0
                AND "wallet_payment_id" IS NULL
            )
        )
    );

CREATE TABLE "wallet_top_up_request_events" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "previous_status" "wallet_top_up_request_status",
    "new_status" "wallet_top_up_request_status" NOT NULL,
    "actor_type" "wallet_actor_type" NOT NULL,
    "actor_id" UUID,
    "reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_top_up_request_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "wallet_top_up_request_events_request_id_created_at_idx"
    ON "wallet_top_up_request_events"("request_id", "created_at");

ALTER TABLE "wallet_top_up_request_events"
    ADD CONSTRAINT "wallet_top_up_request_events_request_id_fkey"
    FOREIGN KEY ("request_id") REFERENCES "wallet_top_up_requests"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "wallet_borrowing_limit_audits" (
    "id" UUID NOT NULL,
    "rider_wallet_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "previous_override" DECIMAL(12,2),
    "new_override" DECIMAL(12,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_borrowing_limit_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "wallet_borrowing_limit_audits_rider_wallet_id_created_at_idx"
    ON "wallet_borrowing_limit_audits"("rider_wallet_id", "created_at");

CREATE INDEX "wallet_borrowing_limit_audits_actor_id_idx"
    ON "wallet_borrowing_limit_audits"("actor_id");

ALTER TABLE "wallet_borrowing_limit_audits"
    ADD CONSTRAINT "wallet_borrowing_limit_audits_rider_wallet_id_fkey"
    FOREIGN KEY ("rider_wallet_id") REFERENCES "rider_wallets"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wallet_borrowing_limit_audits"
    ADD CONSTRAINT "wallet_borrowing_limit_audits_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wallet_borrowing_limit_audits"
    ADD CONSTRAINT "wallet_borrowing_limit_audits_change_chk"
    CHECK (
        "previous_override" IS DISTINCT FROM "new_override"
        AND ("previous_override" IS NULL OR "previous_override" >= 0)
        AND ("new_override" IS NULL OR "new_override" >= 0)
    );

CREATE TABLE "wallet_fee_reservations" (
    "id" UUID NOT NULL,
    "rider_wallet_id" UUID NOT NULL,
    "delivery_id" UUID,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" "currency" NOT NULL,
    "config_version" INTEGER NOT NULL,
    "status" "wallet_fee_reservation_status" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ(6),
    "captured_at" TIMESTAMPTZ(6),

    CONSTRAINT "wallet_fee_reservations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "wallet_fee_reservations_rider_wallet_id_status_idx"
    ON "wallet_fee_reservations"("rider_wallet_id", "status");

CREATE INDEX "wallet_fee_reservations_delivery_id_idx"
    ON "wallet_fee_reservations"("delivery_id");

CREATE UNIQUE INDEX "wallet_fee_reservations_one_open_per_delivery_idx"
    ON "wallet_fee_reservations"("delivery_id")
    WHERE "status" = 'OPEN'::"wallet_fee_reservation_status"
      AND "delivery_id" IS NOT NULL;

ALTER TABLE "wallet_fee_reservations"
    ADD CONSTRAINT "wallet_fee_reservations_rider_wallet_id_fkey"
    FOREIGN KEY ("rider_wallet_id") REFERENCES "rider_wallets"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wallet_fee_reservations"
    ADD CONSTRAINT "wallet_fee_reservations_delivery_id_fkey"
    FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wallet_fee_reservations"
    ADD CONSTRAINT "wallet_fee_reservations_status_chk"
    CHECK (
        "amount" > 0
        AND "currency" = 'USD'::"currency"
        AND "config_version" >= 1
        AND (
            (
                "status" = 'OPEN'::"wallet_fee_reservation_status"
                AND "released_at" IS NULL
                AND "captured_at" IS NULL
            )
            OR (
                "status" = 'RELEASED'::"wallet_fee_reservation_status"
                AND "released_at" IS NOT NULL
                AND "captured_at" IS NULL
            )
            OR (
                "status" = 'CAPTURED'::"wallet_fee_reservation_status"
                AND "captured_at" IS NOT NULL
                AND "released_at" IS NULL
            )
        )
    );

INSERT INTO "wallet_configs" (
    "id",
    "config_version",
    "currency",
    "welcome_bonus",
    "default_borrowing_limit",
    "platform_fee",
    "is_active",
    "created_at",
    "created_by_id"
) VALUES (
    gen_random_uuid(),
    1,
    'USD',
    1.00,
    1.00,
    0.30,
    true,
    CURRENT_TIMESTAMP,
    NULL
);

INSERT INTO "wallet_config_audits" (
    "id",
    "config_version",
    "actor_type",
    "actor_id",
    "previous_welcome_bonus",
    "previous_default_borrowing_limit",
    "previous_platform_fee",
    "new_welcome_bonus",
    "new_default_borrowing_limit",
    "new_platform_fee",
    "created_at"
) VALUES (
    gen_random_uuid(),
    1,
    'SYSTEM',
    NULL,
    NULL,
    NULL,
    NULL,
    1.00,
    1.00,
    0.30,
    CURRENT_TIMESTAMP
);

INSERT INTO "rider_wallets" (
    "id",
    "rider_profile_id",
    "currency",
    "balance",
    "borrowing_limit_override",
    "welcome_bonus_awarded_at",
    "created_at",
    "updated_at"
)
SELECT
    gen_random_uuid(),
    "id",
    'USD'::"currency",
    0.00,
    NULL,
    CASE
        WHEN "approval_status" IN (
            'APPROVED'::"rider_approval_status",
            'SUSPENDED'::"rider_approval_status"
        ) THEN CURRENT_TIMESTAMP
        ELSE NULL
    END,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "rider_profiles";

CREATE FUNCTION "wallet_history_reject_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'wallet history is append-only';
END;
$$;

CREATE TRIGGER "rider_wallet_entries_append_only"
    BEFORE UPDATE OR DELETE ON "rider_wallet_entries"
    FOR EACH ROW
    EXECUTE FUNCTION "wallet_history_reject_mutation"();

CREATE TRIGGER "wallet_config_audits_append_only"
    BEFORE UPDATE OR DELETE ON "wallet_config_audits"
    FOR EACH ROW
    EXECUTE FUNCTION "wallet_history_reject_mutation"();

CREATE TRIGGER "wallet_top_up_request_events_append_only"
    BEFORE UPDATE OR DELETE ON "wallet_top_up_request_events"
    FOR EACH ROW
    EXECUTE FUNCTION "wallet_history_reject_mutation"();

CREATE TRIGGER "wallet_borrowing_limit_audits_append_only"
    BEFORE UPDATE OR DELETE ON "wallet_borrowing_limit_audits"
    FOR EACH ROW
    EXECUTE FUNCTION "wallet_history_reject_mutation"();
