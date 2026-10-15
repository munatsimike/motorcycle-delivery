-- Associate new fee reservations with individual assignments.
-- Existing reservations remain valid with NULL assignment_id.

ALTER TABLE "wallet_fee_reservations"
    ADD COLUMN "assignment_id" UUID;

CREATE UNIQUE INDEX "wallet_fee_reservations_assignment_id_key"
    ON "wallet_fee_reservations"("assignment_id");