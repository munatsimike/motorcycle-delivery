ALTER TABLE "deliveries"
ADD COLUMN "auto_retry_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "next_retry_at" TIMESTAMPTZ(6),
ADD COLUMN "search_started_at" TIMESTAMPTZ(6);
