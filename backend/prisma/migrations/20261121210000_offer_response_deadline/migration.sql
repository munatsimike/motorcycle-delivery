ALTER TABLE "deliveries" ADD COLUMN "offer_response_expires_at" TIMESTAMPTZ(6);
-- Existing unanswered offers receive a fresh five-minute grace period at migration.
UPDATE "deliveries" d SET "offer_response_expires_at" = CURRENT_TIMESTAMP + INTERVAL '5 minutes'
WHERE d."status" = 'CREATED' AND d."service_class" IS NOT NULL AND d."search_generation" = 0
AND EXISTS (SELECT 1 FROM "bids" b WHERE b."delivery_id" = d."id" AND b."status" = 'OPEN');

ALTER TYPE "v2_outbox_event_type" ADD VALUE IF NOT EXISTS 'BID_EXPIRED';
