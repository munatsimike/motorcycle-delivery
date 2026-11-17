-- Cancellation notices. PostgreSQL cannot use an enum value added in
-- the same transaction, so the recipient check is updated afterwards.

ALTER TYPE "v2_outbox_event_type" ADD VALUE IF NOT EXISTS 'RIDER_CANCELLED';
ALTER TYPE "v2_outbox_event_type" ADD VALUE IF NOT EXISTS 'CUSTOMER_CANCELLED';
