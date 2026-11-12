-- Pending EcoCash Online Payments fields on wallet_payments.
-- Additive. Existing cash and admin EcoCash receipts stay valid.
-- Does not update rider_wallets, rider_wallet_entries, promotional rows,
-- borrowing limits, fee reservations, or historical payment references.

ALTER TABLE "wallet_payments"
    ADD COLUMN "payer_msisdn" VARCHAR(16),
    ADD COLUMN "client_correlator" VARCHAR(40),
    ADD COLUMN "reference_code" VARCHAR(64),
    ADD COLUMN "next_lookup_at" TIMESTAMPTZ(6),
    ADD COLUMN "expires_at" TIMESTAMPTZ(6),
    ADD COLUMN "last_provider_response_code" VARCHAR(32),
    ADD COLUMN "refund_reference" VARCHAR(64),
    ADD COLUMN "charge_attempted_at" TIMESTAMPTZ(6),
    ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "wallet_payments_client_correlator_key"
    ON "wallet_payments"("client_correlator");

CREATE UNIQUE INDEX "wallet_payments_reference_code_key"
    ON "wallet_payments"("reference_code");

CREATE UNIQUE INDEX "wallet_payments_refund_reference_key"
    ON "wallet_payments"("refund_reference");

CREATE UNIQUE INDEX "wallet_payments_one_unresolved_idx"
    ON "wallet_payments"("rider_wallet_id")
    WHERE "status" IN (
        'PENDING'::"wallet_payment_status",
        'UNRESOLVED'::"wallet_payment_status"
    );

CREATE INDEX "wallet_payments_ecocash_lookup_idx"
    ON "wallet_payments"("next_lookup_at")
    WHERE "provider" = 'ECOCASH'
        AND "status" IN (
            'PENDING'::"wallet_payment_status",
            'UNRESOLVED'::"wallet_payment_status"
        );

ALTER TABLE "wallet_payments" DROP CONSTRAINT "wallet_payments_shape_chk";

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
