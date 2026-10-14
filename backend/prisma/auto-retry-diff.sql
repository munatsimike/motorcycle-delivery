-- DropForeignKey
ALTER TABLE "delivery_assignments" DROP CONSTRAINT "delivery_assignments_motorcycle_owner_fkey";

-- DropForeignKey
ALTER TABLE "rider_licence_reviews" DROP CONSTRAINT "rider_licence_reviews_image_owner_fkey";

-- DropIndex
DROP INDEX "rider_locations_position_gix";

-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN     "auto_retry_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "next_retry_at" TIMESTAMPTZ(6),
ADD COLUMN     "search_started_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "rider_locations" DROP COLUMN "position";
