-- Records which wallet paid a new commission reservation.
-- Existing rows stay null and keep their original amount and currency.

ALTER TABLE "wallet_fee_reservations"
  ADD COLUMN "source_currency" "currency",
  ADD COLUMN "source_amount" DECIMAL(12, 2),
  ADD COLUMN "exchange_rate_version" INTEGER,
  ADD COLUMN "exchange_rate_zig_per_usd" DECIMAL(12, 4);
