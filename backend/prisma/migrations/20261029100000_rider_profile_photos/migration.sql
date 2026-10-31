-- Private rider profile photos. Bytes stay in object storage.
-- This migration does not alter licence images, approval, or availability.
--
-- Prisma 7.1.0 cannot represent the partial unique indexes below.
-- Do not drop them in a later migration:
--   rider_profile_photos_one_uploading_per_rider_idx
--   rider_profile_photos_one_stored_per_rider_idx

-- CreateEnum
CREATE TYPE "profile_photo_status" AS ENUM ('UPLOADING', 'STORED', 'SUPERSEDED', 'PURGE_PENDING', 'PURGED');

-- CreateTable
CREATE TABLE "rider_profile_photos" (
    "id" UUID NOT NULL,
    "rider_profile_id" UUID NOT NULL,
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

    CONSTRAINT "rider_profile_photos_pkey" PRIMARY KEY ("id")
);

-- A stored or superseded photo has the sanitized metadata.
ALTER TABLE "rider_profile_photos" ADD CONSTRAINT "rider_profile_photos_metadata_chk" CHECK (
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
CREATE UNIQUE INDEX "rider_profile_photos_object_key_key" ON "rider_profile_photos"("object_key");

-- CreateIndex
CREATE INDEX "rider_profile_photos_rider_profile_id_status_idx" ON "rider_profile_photos"("rider_profile_id", "status");

-- CreateIndex
CREATE INDEX "rider_profile_photos_status_created_at_idx" ON "rider_profile_photos"("status", "created_at");

-- CreateIndex
CREATE INDEX "rider_profile_photos_status_purge_after_idx" ON "rider_profile_photos"("status", "purge_after");

-- CreateIndex
CREATE UNIQUE INDEX "rider_profile_photos_one_uploading_per_rider_idx"
    ON "rider_profile_photos"("rider_profile_id")
    WHERE "status" = 'UPLOADING'::"profile_photo_status";

-- CreateIndex
CREATE UNIQUE INDEX "rider_profile_photos_one_stored_per_rider_idx"
    ON "rider_profile_photos"("rider_profile_id")
    WHERE "status" = 'STORED'::"profile_photo_status";

-- AddForeignKey
ALTER TABLE "rider_profile_photos" ADD CONSTRAINT "rider_profile_photos_rider_profile_id_fkey"
    FOREIGN KEY ("rider_profile_id") REFERENCES "rider_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
