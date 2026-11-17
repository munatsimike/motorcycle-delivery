-- One wallet per rider and currency. Existing USD wallet rows, balances,
-- promotional balances, ledger entries, payments, top-up requests, and open
-- reservations are not rewritten. A new empty ZWG wallet is inserted for each
-- rider. Bids, fees, and top-ups stay on the USD wallet.

ALTER TABLE "rider_wallets" DROP CONSTRAINT "rider_wallets_usd_chk";

DROP INDEX "rider_wallets_rider_profile_id_key";

CREATE UNIQUE INDEX "rider_wallets_rider_profile_id_currency_key"
    ON "rider_wallets"("rider_profile_id", "currency");

CREATE UNIQUE INDEX "rider_wallets_id_currency_key"
    ON "rider_wallets"("id", "currency");

INSERT INTO "rider_wallets" (
    "id",
    "rider_profile_id",
    "currency",
    "balance",
    "promotional_balance",
    "borrowing_limit_override",
    "welcome_bonus_awarded_at",
    "created_at",
    "updated_at"
)
SELECT
    gen_random_uuid(),
    "rider_profiles"."id",
    'ZWG'::"currency",
    0.00,
    0.00,
    NULL,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "rider_profiles"
WHERE NOT EXISTS (
    SELECT 1
    FROM "rider_wallets"
    WHERE "rider_wallets"."rider_profile_id" = "rider_profiles"."id"
      AND "rider_wallets"."currency" = 'ZWG'::"currency"
);

-- A child row's currency must be the currency of its wallet. The existing
-- single-column foreign keys stay, so current wallet ids remain valid.
ALTER TABLE "rider_wallet_entries"
    ADD CONSTRAINT "rider_wallet_entries_wallet_currency_fkey"
    FOREIGN KEY ("rider_wallet_id", "currency")
    REFERENCES "rider_wallets"("id", "currency")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rider_promotional_entries"
    ADD CONSTRAINT "rider_promotional_entries_wallet_currency_fkey"
    FOREIGN KEY ("rider_wallet_id", "currency")
    REFERENCES "rider_wallets"("id", "currency")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wallet_payments"
    ADD CONSTRAINT "wallet_payments_wallet_currency_fkey"
    FOREIGN KEY ("rider_wallet_id", "currency")
    REFERENCES "rider_wallets"("id", "currency")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wallet_fee_reservations"
    ADD CONSTRAINT "wallet_fee_reservations_wallet_currency_fkey"
    FOREIGN KEY ("rider_wallet_id", "currency")
    REFERENCES "rider_wallets"("id", "currency")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- wallet_top_up_requests have no currency column. rider_wallet_id already
-- binds each request to one wallet, and that wallet now has one currency.

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
        )
    );

ALTER TABLE "rider_promotional_entries" DROP CONSTRAINT "rider_promotional_entries_shape_chk";

ALTER TABLE "rider_promotional_entries"
    ADD CONSTRAINT "rider_promotional_entries_shape_chk"
    CHECK (
        "config_version" >= 1
        AND "balance_after" >= 0
        AND (
            ("entry_type" = 'ISSUED'::"promotional_entry_type" AND "amount" > 0 AND "reservation_id" IS NULL)
            OR ("entry_type" = 'CONSUMED'::"promotional_entry_type" AND "amount" < 0 AND "reservation_id" IS NOT NULL)
        )
    );

ALTER TABLE "wallet_payments" DROP CONSTRAINT "wallet_payments_shape_chk";

ALTER TABLE "wallet_payments"
    ADD CONSTRAINT "wallet_payments_shape_chk"
    CHECK (
        "amount" > 0
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
                AND "payer_msisdn" IS NULL
                AND "client_correlator" IS NULL
                AND "reference_code" IS NULL
                AND "charge_attempted_at" IS NULL
            )
            OR (
                "method" = 'ECOCASH'::"wallet_payment_method"
                AND "ecocash_reference" IS NOT NULL
                AND btrim("ecocash_reference") <> ''
                AND "internal_receipt_id" IS NULL
                AND "external_receipt_number" IS NULL
                AND "provider" IS NULL
                AND "provider_transaction_id" IS NULL
                AND "payer_msisdn" IS NULL
                AND "client_correlator" IS NULL
                AND "reference_code" IS NULL
                AND "charge_attempted_at" IS NULL
            )
            OR (
                "method" = 'GATEWAY'::"wallet_payment_method"
                AND "provider" IS NOT NULL
                AND btrim("provider") <> ''
                AND "provider" <> 'ECOCASH'
                AND "provider_transaction_id" IS NOT NULL
                AND btrim("provider_transaction_id") <> ''
                AND "internal_receipt_id" IS NULL
                AND "external_receipt_number" IS NULL
                AND "ecocash_reference" IS NULL
                AND "payer_msisdn" IS NULL
                AND "client_correlator" IS NULL
                AND "reference_code" IS NULL
                AND "charge_attempted_at" IS NULL
            )
            OR (
                "method" = 'GATEWAY'::"wallet_payment_method"
                AND "provider" = 'ECOCASH'
                AND "client_correlator" IS NOT NULL
                AND "client_correlator" ~ '^[A-Za-z0-9]{8,40}$'
                AND "reference_code" IS NOT NULL
                AND "reference_code" ~ '^[A-Za-z0-9]{8,64}$'
                AND "payer_msisdn" IS NOT NULL
                AND "payer_msisdn" ~ '^7[0-9]{8}$'
                AND "internal_receipt_id" IS NULL
                AND "external_receipt_number" IS NULL
                AND "next_lookup_at" IS NOT NULL
                AND "expires_at" IS NOT NULL
                AND (
                    (
                        "provider_transaction_id" IS NULL
                        AND "ecocash_reference" IS NULL
                    )
                    OR (
                        "provider_transaction_id" IS NOT NULL
                        AND btrim("provider_transaction_id") <> ''
                        AND "ecocash_reference" = "provider_transaction_id"
                    )
                )
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
                    'FAILED'::"wallet_payment_status",
                    'EXPIRED'::"wallet_payment_status",
                    'UNRESOLVED'::"wallet_payment_status"
                )
                AND "verified_at" IS NULL
            )
            OR (
                "status" IN (
                    'REFUNDED'::"wallet_payment_status",
                    'REVERSED'::"wallet_payment_status"
                )
                AND "verified_at" IS NOT NULL
                AND "refund_reference" IS NOT NULL
                AND btrim("refund_reference") <> ''
            )
        )
        AND (
            "refund_reference" IS NULL
            OR "status" IN (
                'REFUNDED'::"wallet_payment_status",
                'REVERSED'::"wallet_payment_status"
            )
        )
    );

ALTER TABLE "wallet_fee_reservations" DROP CONSTRAINT "wallet_fee_reservations_status_chk";

ALTER TABLE "wallet_fee_reservations"
    ADD CONSTRAINT "wallet_fee_reservations_status_chk"
    CHECK (
        "amount" > 0
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
