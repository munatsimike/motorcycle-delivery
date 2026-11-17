-- A bid may use USD or ZWG. The application rejects a bid whose currency
-- does not match its delivery. Wallet configuration and delivery pricing
-- stay USD-only.
ALTER TABLE "bids" DROP CONSTRAINT IF EXISTS "bids_currency_usd_chk";

-- PLATFORM_FEE_REFUND has been written by the application since the
-- commission-policy enum change, but the row-shape check never allowed it.
ALTER TABLE "rider_wallet_entries" DROP CONSTRAINT "rider_wallet_entries_shape_chk";

ALTER TABLE "rider_wallet_entries"
    ADD CONSTRAINT "rider_wallet_entries_shape_chk"
    CHECK (
        "config_version" >= 1
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
            OR (
                "entry_type" = 'PLATFORM_FEE_REFUND'::"wallet_entry_type"
                AND "amount" > 0
                AND "wallet_payment_id" IS NULL
            )
        )
    );
