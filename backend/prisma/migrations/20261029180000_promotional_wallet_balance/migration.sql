-- Separate promotional credit from the signed cash balance, starting now.
-- Existing rider_wallets.balance, rider_wallet_entries, top-ups, reservations,
-- and welcome_bonus_awarded_at are left unchanged. Historical welcome and
-- promotional rows that already increased balance are not subtracted or reissued.
-- A new active wallet_configs version is published only when the current
-- default borrowing limit is not already 500.00. The seeded version is not edited.

CREATE TYPE "promotional_entry_type" AS ENUM ('ISSUED', 'CONSUMED');

ALTER TABLE "rider_wallets"
    ADD COLUMN "promotional_balance" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "rider_wallets"
    ADD CONSTRAINT "rider_wallets_promotional_balance_chk"
    CHECK ("promotional_balance" >= 0);

ALTER TABLE "wallet_fee_reservations"
    ADD COLUMN "promotional_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN "wallet_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

UPDATE "wallet_fee_reservations"
SET "promotional_amount" = 0,
    "wallet_amount" = "amount";

ALTER TABLE "wallet_fee_reservations"
    ADD CONSTRAINT "wallet_fee_reservations_split_chk"
    CHECK (
        "promotional_amount" >= 0
        AND "wallet_amount" >= 0
        AND "promotional_amount" + "wallet_amount" = "amount"
    );

CREATE TABLE "rider_promotional_entries" (
    "id" UUID NOT NULL,
    "rider_wallet_id" UUID NOT NULL,
    "entry_type" "promotional_entry_type" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balance_after" DECIMAL(12,2) NOT NULL,
    "currency" "currency" NOT NULL,
    "config_version" INTEGER NOT NULL,
    "idempotency_key" VARCHAR(200) NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "reservation_id" UUID,
    "reason" VARCHAR(500),
    "actor_type" "wallet_actor_type" NOT NULL,
    "actor_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rider_promotional_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rider_promotional_entries_idempotency_key_key"
    ON "rider_promotional_entries"("idempotency_key");

CREATE UNIQUE INDEX "rider_promotional_entries_reservation_id_key"
    ON "rider_promotional_entries"("reservation_id");

CREATE INDEX "rider_promotional_entries_rider_wallet_id_created_at_idx"
    ON "rider_promotional_entries"("rider_wallet_id", "created_at");

CREATE INDEX "rider_promotional_entries_actor_id_idx"
    ON "rider_promotional_entries"("actor_id");

ALTER TABLE "rider_promotional_entries"
    ADD CONSTRAINT "rider_promotional_entries_rider_wallet_id_fkey"
    FOREIGN KEY ("rider_wallet_id") REFERENCES "rider_wallets"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rider_promotional_entries"
    ADD CONSTRAINT "rider_promotional_entries_reservation_id_fkey"
    FOREIGN KEY ("reservation_id") REFERENCES "wallet_fee_reservations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rider_promotional_entries"
    ADD CONSTRAINT "rider_promotional_entries_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rider_promotional_entries"
    ADD CONSTRAINT "rider_promotional_entries_shape_chk"
    CHECK (
        "currency" = 'USD'::"currency"
        AND "config_version" >= 1
        AND "balance_after" >= 0
        AND (
            ("entry_type" = 'ISSUED'::"promotional_entry_type" AND "amount" > 0 AND "reservation_id" IS NULL)
            OR ("entry_type" = 'CONSUMED'::"promotional_entry_type" AND "amount" < 0 AND "reservation_id" IS NOT NULL)
        )
    );

CREATE TRIGGER "rider_promotional_entries_append_only"
    BEFORE UPDATE OR DELETE ON "rider_promotional_entries"
    FOR EACH ROW
    EXECUTE FUNCTION "wallet_history_reject_mutation"();

-- Publish the next configuration version. Copy the live welcome bonus and
-- platform fee. Leave per-rider borrowing_limit_override values untouched.
DO $$
DECLARE
    active "wallet_configs"%ROWTYPE;
    next_version INTEGER;
BEGIN
    SELECT * INTO active
    FROM "wallet_configs"
    WHERE "is_active" = true
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Wallet configuration is not configured';
    END IF;

    IF active."default_borrowing_limit" = 500.00 THEN
        RETURN;
    END IF;

    next_version := active."config_version" + 1;

    UPDATE "wallet_configs"
    SET "is_active" = false
    WHERE "id" = active."id";

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
        next_version,
        'USD',
        active."welcome_bonus",
        500.00,
        active."platform_fee",
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
        next_version,
        'SYSTEM',
        NULL,
        active."welcome_bonus",
        active."default_borrowing_limit",
        active."platform_fee",
        active."welcome_bonus",
        500.00,
        active."platform_fee",
        CURRENT_TIMESTAMP
    );
END $$;
