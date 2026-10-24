-- Milestone 2A. A V2 request stays CREATED with search_generation 0, so the
-- V1 dispatch scan of SEARCHING rows does not offer it. price, payer, and
-- payment_method may be null until a bid is accepted. V1 create still writes
-- all three. OPEN bids become EXPIRED by a status update when deliver_by
-- passes. This file does not delete bid rows and does not insert any.
-- Do not drop:
--   bids_one_open_per_rider_delivery_idx
--   bids_one_accepted_per_delivery_idx
--   bids_idempotency_key_key
--   bids_amount_nonnegative_chk
--   bids_currency_usd_chk
--   bids_idempotency_pair_chk
--   delivery_assignments_one_accepted_per_rider_idx
--   delivery_assignments_one_accepted_per_delivery_idx

ALTER TABLE "deliveries" ALTER COLUMN "price" DROP NOT NULL;
ALTER TABLE "deliveries" ALTER COLUMN "payer" DROP NOT NULL;
ALTER TABLE "deliveries" ALTER COLUMN "payment_method" DROP NOT NULL;

ALTER TABLE "deliveries" ADD COLUMN "pricing_model" "pricing_model";
ALTER TABLE "deliveries" ADD COLUMN "pricing_basis_points" INTEGER;
ALTER TABLE "deliveries" ADD COLUMN "pricing_window_id" UUID;

ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_pricing_window_id_fkey"
    FOREIGN KEY ("pricing_window_id") REFERENCES "pricing_windows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bids" ADD COLUMN "idempotency_key" VARCHAR(200);
ALTER TABLE "bids" ADD COLUMN "payload_hash" CHAR(64);

CREATE UNIQUE INDEX "bids_idempotency_key_key" ON "bids"("idempotency_key");

ALTER TABLE "bids" ADD CONSTRAINT "bids_amount_nonnegative_chk" CHECK ("amount" >= 0);
ALTER TABLE "bids" ADD CONSTRAINT "bids_currency_usd_chk" CHECK ("currency" = 'USD'::"currency");
ALTER TABLE "bids" ADD CONSTRAINT "bids_idempotency_pair_chk" CHECK (
    ("idempotency_key" IS NULL) = ("payload_hash" IS NULL)
);
