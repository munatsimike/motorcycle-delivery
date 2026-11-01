-- New outbox labels. They are not used in this file. PostgreSQL cannot
-- use an enum value added in the same transaction.

ALTER TYPE "v2_outbox_event_type" ADD VALUE IF NOT EXISTS 'RIDER_OPPORTUNITY';
ALTER TYPE "v2_outbox_event_type" ADD VALUE IF NOT EXISTS 'BID_RECEIVED';
ALTER TYPE "v2_outbox_event_type" ADD VALUE IF NOT EXISTS 'COUNTEROFFER';
ALTER TYPE "v2_outbox_event_type" ADD VALUE IF NOT EXISTS 'ACCOUNT_APPROVED';
