-- Booking idempotency for POST /customers/me/deliveries.
-- Existing rows stay valid: both columns are nullable and the check allows
-- that pair to remain null. A key cannot be stored without its payload hash.

ALTER TABLE "deliveries" ADD COLUMN "create_idempotency_key" VARCHAR(200);
ALTER TABLE "deliveries" ADD COLUMN "create_payload_hash" CHAR(64);

CREATE UNIQUE INDEX "deliveries_create_idempotency_key_key" ON "deliveries"("create_idempotency_key");

ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_create_idempotency_pair_chk" CHECK (
    ("create_idempotency_key" IS NULL) = ("create_payload_hash" IS NULL)
);
