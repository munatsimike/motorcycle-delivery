-- Records a verified ZiG credit that arrived after the USD cash balance
-- became negative. It does not move funds between wallets.
CREATE TABLE "wallet_payment_exceptions" (
    "id" UUID NOT NULL,
    "wallet_payment_id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "usd_balance" DECIMAL(12, 2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_payment_exceptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wallet_payment_exceptions_wallet_payment_id_key"
    ON "wallet_payment_exceptions"("wallet_payment_id");

ALTER TABLE "wallet_payment_exceptions"
    ADD CONSTRAINT "wallet_payment_exceptions_wallet_payment_id_fkey"
    FOREIGN KEY ("wallet_payment_id") REFERENCES "wallet_payments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
