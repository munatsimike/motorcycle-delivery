-- Terminal FAILED state for a V2 notice after genuine provider failures.
-- Adds inspection columns. Does not insert or update existing rows, and does
-- not use the new status value in this file. Missing devices and an
-- unconfigured provider stay PENDING.

ALTER TYPE "v2_outbox_status" ADD VALUE IF NOT EXISTS 'FAILED';

ALTER TABLE "v2_outbox_events" ADD COLUMN "last_failure" VARCHAR(40);
ALTER TABLE "v2_outbox_events" ADD COLUMN "last_attempt_at" TIMESTAMPTZ(6);
ALTER TABLE "v2_outbox_events" ADD COLUMN "failed_at" TIMESTAMPTZ(6);
