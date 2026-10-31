-- V2 assignments created without a customer deadline store no offer expiry.
-- Existing rows keep the timestamp already stored.
ALTER TABLE "delivery_assignments" ALTER COLUMN "offer_expires_at" DROP NOT NULL;
