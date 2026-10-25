-- Keep the address collected during rider registration on the rider profile.
ALTER TABLE "rider_profiles" ADD COLUMN "address" VARCHAR(500);
