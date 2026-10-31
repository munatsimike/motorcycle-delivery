-- Private customer profile photos. Bytes stay in object storage.
-- This migration does not alter rider profile photos.
--
-- Prisma 7.1.0 cannot represent the partial unique indexes below.
-- Do not drop them in a later migration:
--   customer_profile_photos_one_uploading_per_customer_idx
--   customer_profile_photos_one_stored_per_customer_idx

-- CreateTable
CREATE TABLE "customer_profile_photos" (
    "id" UUID NOT NULL,
    "customer_account_id" UUID NOT NULL,
    "object_key" VARCHAR(200) NOT NULL,
    "content_type" VARCHAR(40),
    "byte_size" INTEGER,
    "sha256" CHAR(64),
    "status" "profile_photo_status" NOT NULL DEFAULT 'UPLOADING',
    "uploaded_at" TIMESTAMPTZ(6),
    "superseded_at" TIMESTAMPTZ(6),
    "purge_after" TIMESTAMPTZ(6),
    "purged_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_profile_photos_pkey" PRIMARY KEY ("id")
);

-- A stored or superseded photo has the sanitized metadata.
ALTER TABLE "customer_profile_photos" ADD CONSTRAINT "customer_profile_photos_metadata_chk" CHECK (
    (
        "status" NOT IN ('STORED'::"profile_photo_status", 'SUPERSEDED'::"profile_photo_status")
    )
    OR (
        "content_type" IS NOT NULL
        AND "byte_size" IS NOT NULL
        AND "byte_size" > 0
        AND "sha256" IS NOT NULL
        AND "uploaded_at" IS NOT NULL
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_profile_photos_object_key_key" ON "customer_profile_photos"("object_key");

-- CreateIndex
CREATE INDEX "customer_profile_photos_customer_account_id_status_idx" ON "customer_profile_photos"("customer_account_id", "status");

-- CreateIndex
CREATE INDEX "customer_profile_photos_status_created_at_idx" ON "customer_profile_photos"("status", "created_at");

-- CreateIndex
CREATE INDEX "customer_profile_photos_status_purge_after_idx" ON "customer_profile_photos"("status", "purge_after");

-- CreateIndex
CREATE UNIQUE INDEX "customer_profile_photos_one_uploading_per_customer_idx"
    ON "customer_profile_photos"("customer_account_id")
    WHERE "status" = 'UPLOADING'::"profile_photo_status";

-- CreateIndex
CREATE UNIQUE INDEX "customer_profile_photos_one_stored_per_customer_idx"
    ON "customer_profile_photos"("customer_account_id")
    WHERE "status" = 'STORED'::"profile_photo_status";

-- AddForeignKey
ALTER TABLE "customer_profile_photos" ADD CONSTRAINT "customer_profile_photos_customer_account_id_fkey"
    FOREIGN KEY ("customer_account_id") REFERENCES "customer_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;