-- Private rider licence images. Bytes stay in object storage.
-- This migration does not alter PostGIS catalogs, delivery tables, or
-- previously applied constraints.
--
-- Prisma 7.1.0 cannot represent the partial unique indexes below.
-- Do not drop them in a later migration:
--   rider_licence_images_one_uploading_per_rider_idx
--   rider_licence_images_one_stored_per_rider_idx

-- CreateEnum
CREATE TYPE "licence_image_status" AS ENUM ('UPLOADING', 'STORED', 'SUPERSEDED', 'PURGE_PENDING', 'PURGED');

-- CreateEnum
CREATE TYPE "licence_image_review_status" AS ENUM ('PENDING');

-- CreateTable
CREATE TABLE "rider_licence_images" (
    "id" UUID NOT NULL,
    "rider_profile_id" UUID NOT NULL,
    "object_key" VARCHAR(200) NOT NULL,
    "content_type" VARCHAR(40),
    "byte_size" INTEGER,
    "sha256" CHAR(64),
    "status" "licence_image_status" NOT NULL DEFAULT 'UPLOADING',
    "review_status" "licence_image_review_status" NOT NULL DEFAULT 'PENDING',
    "uploaded_at" TIMESTAMPTZ(6),
    "superseded_at" TIMESTAMPTZ(6),
    "purge_after" TIMESTAMPTZ(6),
    "purged_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rider_licence_images_pkey" PRIMARY KEY ("id")
);

-- A stored or superseded image has the sanitized metadata. Abandoned uploads
-- can be purged before those fields are known.
ALTER TABLE "rider_licence_images" ADD CONSTRAINT "rider_licence_images_metadata_chk" CHECK (
    (
        "status" NOT IN ('STORED'::"licence_image_status", 'SUPERSEDED'::"licence_image_status")
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
CREATE UNIQUE INDEX "rider_licence_images_object_key_key" ON "rider_licence_images"("object_key");

-- CreateIndex
CREATE INDEX "rider_licence_images_rider_profile_id_status_idx" ON "rider_licence_images"("rider_profile_id", "status");

-- CreateIndex
CREATE INDEX "rider_licence_images_status_created_at_idx" ON "rider_licence_images"("status", "created_at");

-- CreateIndex
CREATE INDEX "rider_licence_images_status_purge_after_idx" ON "rider_licence_images"("status", "purge_after");

-- CreateIndex
CREATE UNIQUE INDEX "rider_licence_images_one_uploading_per_rider_idx"
    ON "rider_licence_images"("rider_profile_id")
    WHERE "status" = 'UPLOADING'::"licence_image_status";

-- CreateIndex
CREATE UNIQUE INDEX "rider_licence_images_one_stored_per_rider_idx"
    ON "rider_licence_images"("rider_profile_id")
    WHERE "status" = 'STORED'::"licence_image_status";

-- AddForeignKey
ALTER TABLE "rider_licence_images" ADD CONSTRAINT "rider_licence_images_rider_profile_id_fkey"
    FOREIGN KEY ("rider_profile_id") REFERENCES "rider_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
