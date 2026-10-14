-- Fingerprint PostGIS catalog relations before this migration changes anything.
-- The closing guard fails the migration if those relations are dropped, rewritten,
-- or if spatial_ref_sys contents change. This script never writes to them.
-- Relations: spatial_ref_sys, geometry_columns, geography_columns,
-- raster_columns, raster_overviews.

CREATE TEMP TABLE "postgis_catalog_guard" (
    "object_key" TEXT PRIMARY KEY,
    "schema_name" TEXT NOT NULL,
    "object_name" TEXT NOT NULL,
    "object_kind" "char" NOT NULL,
    "column_fingerprint" TEXT NOT NULL,
    "definition_fingerprint" TEXT,
    "data_fingerprint" TEXT
);

DO $postgis_guard_start$
DECLARE
    catalog RECORD;
    column_fingerprint TEXT;
    definition_fingerprint TEXT;
    data_fingerprint TEXT;
BEGIN
    FOR catalog IN
        SELECT n.nspname AS schema_name,
               c.relname AS object_name,
               c.oid,
               c.relkind
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname IN (
            'spatial_ref_sys',
            'geometry_columns',
            'geography_columns',
            'raster_columns',
            'raster_overviews'
        )
          AND c.relkind IN ('r', 'v', 'm')
          AND n.nspname <> 'pg_toast'
    LOOP
        SELECT md5(COALESCE(string_agg(
                   a.attname || ':' || a.atttypid::text || ':' || a.atttypmod::text || ':' || a.attnotnull::text,
                   ',' ORDER BY a.attnum
               ), ''))
          INTO column_fingerprint
          FROM pg_attribute a
         WHERE a.attrelid = catalog.oid
           AND a.attnum > 0
           AND NOT a.attisdropped;

        definition_fingerprint := NULL;
        IF catalog.relkind IN ('v', 'm') THEN
            definition_fingerprint := md5(pg_get_viewdef(catalog.oid, true));
        END IF;

        data_fingerprint := NULL;
        IF catalog.object_name = 'spatial_ref_sys' AND catalog.relkind = 'r' THEN
            EXECUTE format(
                'SELECT md5(COALESCE(string_agg(srid::text || '':'' || COALESCE(auth_name, '''') || '':'' || COALESCE(auth_srid::text, ''''), '','' ORDER BY srid), '''')) FROM %I.%I',
                catalog.schema_name,
                catalog.object_name
            )
            INTO data_fingerprint;
        END IF;

        INSERT INTO "postgis_catalog_guard" (
            "object_key",
            "schema_name",
            "object_name",
            "object_kind",
            "column_fingerprint",
            "definition_fingerprint",
            "data_fingerprint"
        ) VALUES (
            catalog.schema_name || '.' || catalog.object_name,
            catalog.schema_name,
            catalog.object_name,
            catalog.relkind,
            column_fingerprint,
            definition_fingerprint,
            data_fingerprint
        );
    END LOOP;
END
$postgis_guard_start$;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('CUSTOMER', 'RIDER', 'ADMIN');

-- CreateEnum
CREATE TYPE "account_status" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "rider_verification_status" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "rider_approval_status" AS ENUM ('PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "rider_availability" AS ENUM ('OFFLINE', 'AVAILABLE', 'BUSY');

-- CreateEnum
CREATE TYPE "motorcycle_verification_status" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "delivery_type" AS ENUM ('PARCEL');

-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('CREATED', 'SEARCHING', 'ASSIGNED', 'ARRIVED_AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DROPOFF', 'DELIVERED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "assignment_status" AS ENUM ('OFFERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'RELEASED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "assignment_release_reason" AS ENUM ('RIDER_CANCELLED', 'VEHICLE_PROBLEM', 'RIDER_UNRESPONSIVE', 'ADMIN_REASSIGNED', 'CUSTOMER_CANCELLED', 'ADMIN_CANCELLED');

-- CreateEnum
CREATE TYPE "currency" AS ENUM ('USD', 'ZWG');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('CASH', 'ECOCASH', 'ONEMONEY', 'INNBUCKS', 'ZIPIT');

-- CreateEnum
CREATE TYPE "delivery_actor_type" AS ENUM ('CUSTOMER', 'RIDER', 'ADMIN', 'SYSTEM');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "full_name" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "email" VARCHAR(254),
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "user_role" NOT NULL,
    "account_status" "account_status" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rider_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "verification_status" "rider_verification_status" NOT NULL DEFAULT 'PENDING',
    "approval_status" "rider_approval_status" NOT NULL DEFAULT 'PENDING',
    "availability" "rider_availability" NOT NULL DEFAULT 'OFFLINE',
    "licence_number" VARCHAR(50) NOT NULL,
    "licence_expires_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rider_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "motorcycles" (
    "id" UUID NOT NULL,
    "rider_profile_id" UUID NOT NULL,
    "registration_number" VARCHAR(20) NOT NULL,
    "make" VARCHAR(80) NOT NULL,
    "model" VARCHAR(80) NOT NULL,
    "verification_status" "motorcycle_verification_status" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "motorcycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "delivery_type" "delivery_type" NOT NULL DEFAULT 'PARCEL',
    "pickup_address" VARCHAR(500) NOT NULL,
    "pickup_latitude" DECIMAL(10,7) NOT NULL,
    "pickup_longitude" DECIMAL(10,7) NOT NULL,
    "dropoff_address" VARCHAR(500) NOT NULL,
    "dropoff_latitude" DECIMAL(10,7) NOT NULL,
    "dropoff_longitude" DECIMAL(10,7) NOT NULL,
    "parcel_description" VARCHAR(500) NOT NULL,
    "recipient_name" VARCHAR(200),
    "recipient_phone" VARCHAR(20),
    "price" DECIMAL(12,2) NOT NULL,
    "currency" "currency" NOT NULL DEFAULT 'USD',
    "payment_method" "payment_method" NOT NULL,
    "status" "delivery_status" NOT NULL DEFAULT 'CREATED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_assignments" (
    "id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "rider_profile_id" UUID NOT NULL,
    "status" "assignment_status" NOT NULL DEFAULT 'OFFERED',
    "offer_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "responded_at" TIMESTAMPTZ(6),
    "release_reason" "assignment_release_reason",
    "released_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_status_events" (
    "id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "previous_status" "delivery_status",
    "new_status" "delivery_status" NOT NULL,
    "actor_id" UUID,
    "actor_type" "delivery_actor_type" NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_account_status_idx" ON "users"("role", "account_status");

-- CreateIndex
CREATE UNIQUE INDEX "rider_profiles_user_id_key" ON "rider_profiles"("user_id");

-- CreateIndex
CREATE INDEX "rider_profiles_approval_status_availability_idx" ON "rider_profiles"("approval_status", "availability");

-- CreateIndex
CREATE UNIQUE INDEX "motorcycles_registration_number_key" ON "motorcycles"("registration_number");

-- CreateIndex
CREATE INDEX "motorcycles_rider_profile_id_verification_status_idx" ON "motorcycles"("rider_profile_id", "verification_status");

-- CreateIndex
CREATE INDEX "deliveries_customer_id_created_at_idx" ON "deliveries"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "deliveries_status_created_at_idx" ON "deliveries"("status", "created_at");

-- CreateIndex
CREATE INDEX "delivery_assignments_delivery_id_status_idx" ON "delivery_assignments"("delivery_id", "status");

-- CreateIndex
CREATE INDEX "delivery_assignments_rider_profile_id_status_idx" ON "delivery_assignments"("rider_profile_id", "status");

-- CreateIndex
CREATE INDEX "delivery_assignments_offer_expires_at_idx" ON "delivery_assignments"("offer_expires_at");

-- CreateIndex
CREATE INDEX "delivery_status_events_delivery_id_occurred_at_idx" ON "delivery_status_events"("delivery_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "rider_profiles" ADD CONSTRAINT "rider_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "motorcycles" ADD CONSTRAINT "motorcycles_rider_profile_id_fkey" FOREIGN KEY ("rider_profile_id") REFERENCES "rider_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_rider_profile_id_fkey" FOREIGN KEY ("rider_profile_id") REFERENCES "rider_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_status_events" ADD CONSTRAINT "delivery_status_events_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_status_events" ADD CONSTRAINT "delivery_status_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Checks and partial unique indexes are invisible to Prisma 7.1.0.
-- Do not drop them in a later generated migration.
-- PostgreSQL POSIX regex has no \d; E.164 uses [0-9].

ALTER TABLE "users"
    ADD CONSTRAINT "users_phone_e164_chk"
    CHECK ("phone" ~ '^\+[1-9][0-9]{7,14}$');

ALTER TABLE "deliveries"
    ADD CONSTRAINT "deliveries_recipient_phone_e164_chk"
    CHECK ("recipient_phone" IS NULL OR "recipient_phone" ~ '^\+[1-9][0-9]{7,14}$');

ALTER TABLE "deliveries"
    ADD CONSTRAINT "deliveries_price_nonnegative_chk"
    CHECK ("price" >= 0);

ALTER TABLE "deliveries"
    ADD CONSTRAINT "deliveries_pickup_latitude_chk"
    CHECK ("pickup_latitude" >= -90 AND "pickup_latitude" <= 90);

ALTER TABLE "deliveries"
    ADD CONSTRAINT "deliveries_pickup_longitude_chk"
    CHECK ("pickup_longitude" >= -180 AND "pickup_longitude" <= 180);

ALTER TABLE "deliveries"
    ADD CONSTRAINT "deliveries_dropoff_latitude_chk"
    CHECK ("dropoff_latitude" >= -90 AND "dropoff_latitude" <= 90);

ALTER TABLE "deliveries"
    ADD CONSTRAINT "deliveries_dropoff_longitude_chk"
    CHECK ("dropoff_longitude" >= -180 AND "dropoff_longitude" <= 180);

ALTER TABLE "rider_profiles"
    ADD CONSTRAINT "rider_profiles_availability_requires_approval_chk"
    CHECK ("approval_status" = 'APPROVED' OR "availability" = 'OFFLINE');

ALTER TABLE "delivery_assignments"
    ADD CONSTRAINT "delivery_assignments_response_chk"
    CHECK (
        ("status" = 'OFFERED' AND "responded_at" IS NULL)
        OR (
            "status" IN ('ACCEPTED', 'REJECTED', 'RELEASED', 'COMPLETED', 'FAILED')
            AND "responded_at" IS NOT NULL
        )
        OR ("status" IN ('EXPIRED', 'CANCELLED'))
    );

ALTER TABLE "delivery_assignments"
    ADD CONSTRAINT "delivery_assignments_release_chk"
    CHECK (
        (
            "status" = 'RELEASED'
            AND "released_at" IS NOT NULL
            AND "release_reason" IS NOT NULL
            AND "responded_at" IS NOT NULL
        )
        OR (
            "status" <> 'RELEASED'
            AND "released_at" IS NULL
            AND "release_reason" IS NULL
        )
    );

ALTER TABLE "delivery_status_events"
    ADD CONSTRAINT "delivery_status_events_actor_chk"
    CHECK (
        ("actor_type" = 'SYSTEM' AND "actor_id" IS NULL)
        OR (
            "actor_type" IN ('CUSTOMER', 'RIDER', 'ADMIN')
            AND "actor_id" IS NOT NULL
        )
    );

-- ACCEPTED means the one live assignment. Completed and released rows stay
-- in the table, so assignment history is not deleted.
CREATE UNIQUE INDEX "delivery_assignments_one_accepted_per_delivery_idx"
    ON "delivery_assignments" ("delivery_id")
    WHERE "status" = 'ACCEPTED';

CREATE UNIQUE INDEX "delivery_assignments_one_accepted_per_rider_idx"
    ON "delivery_assignments" ("rider_profile_id")
    WHERE "status" = 'ACCEPTED';

CREATE UNIQUE INDEX "delivery_assignments_one_open_offer_per_rider_idx"
    ON "delivery_assignments" ("delivery_id", "rider_profile_id")
    WHERE "status" IN ('OFFERED', 'ACCEPTED');


-- NestJS delivery workflows, not database triggers.
-- The deliveries module service must run each workflow below in one transaction,
-- locking the delivery, then the rider profile, then the assignment:
--   Accept: only an unexpired OFFERED row; cancel that rider's other OFFERED
--   rows and the other OFFERED rows on the same delivery; set the rider BUSY;
--   set the delivery ASSIGNED; insert one delivery status event.
--   Release before pickup: keep this assignment row; set release_reason and
--   released_at; return the rider to AVAILABLE or OFFLINE; move the delivery
--   to SEARCHING for a reassignment reason, or to CANCELLED for
--   CUSTOMER_CANCELLED or ADMIN_CANCELLED; insert one delivery status event.
--   Complete or fail: move the assignment from ACCEPTED to COMPLETED or FAILED;
--   update rider availability; insert the delivery status event for that
--   transition.
-- Do not delete assignment rows or status events. Deactivate accounts instead
-- of deleting users.

-- Fail if this migration dropped, replaced, or rewrote a PostGIS catalog
-- relation that existed when the migration started. Reads only.

DO $postgis_guard_end$
DECLARE
    guarded RECORD;
    current_oid OID;
    current_kind "char";
    column_fingerprint TEXT;
    definition_fingerprint TEXT;
    data_fingerprint TEXT;
BEGIN
    FOR guarded IN
        SELECT *
          FROM "postgis_catalog_guard"
    LOOP
        SELECT c.oid, c.relkind
          INTO current_oid, current_kind
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = guarded.schema_name
           AND c.relname = guarded.object_name
           AND c.relkind = guarded.object_kind;

        IF current_oid IS NULL THEN
            RAISE EXCEPTION 'PostGIS catalog object %.% was removed or replaced',
                guarded.schema_name, guarded.object_name;
        END IF;

        SELECT md5(COALESCE(string_agg(
                   a.attname || ':' || a.atttypid::text || ':' || a.atttypmod::text || ':' || a.attnotnull::text,
                   ',' ORDER BY a.attnum
               ), ''))
          INTO column_fingerprint
          FROM pg_attribute a
         WHERE a.attrelid = current_oid
           AND a.attnum > 0
           AND NOT a.attisdropped;

        IF column_fingerprint IS DISTINCT FROM guarded.column_fingerprint
           OR current_kind IS DISTINCT FROM guarded.object_kind THEN
            RAISE EXCEPTION 'PostGIS catalog object %.% was altered',
                guarded.schema_name, guarded.object_name;
        END IF;

        definition_fingerprint := NULL;
        IF current_kind IN ('v', 'm') THEN
            definition_fingerprint := md5(pg_get_viewdef(current_oid, true));
        END IF;
        IF definition_fingerprint IS DISTINCT FROM guarded.definition_fingerprint THEN
            RAISE EXCEPTION 'PostGIS catalog view %.% was replaced',
                guarded.schema_name, guarded.object_name;
        END IF;

        IF guarded.object_name = 'spatial_ref_sys' AND current_kind = 'r' THEN
            EXECUTE format(
                'SELECT md5(COALESCE(string_agg(srid::text || '':'' || COALESCE(auth_name, '''') || '':'' || COALESCE(auth_srid::text, ''''), '','' ORDER BY srid), '''')) FROM %I.%I',
                guarded.schema_name,
                guarded.object_name
            )
            INTO data_fingerprint;
            IF data_fingerprint IS DISTINCT FROM guarded.data_fingerprint THEN
                RAISE EXCEPTION 'PostGIS spatial_ref_sys contents were changed';
            END IF;
        END IF;
    END LOOP;
END
$postgis_guard_end$;

DROP TABLE IF EXISTS pg_temp.postgis_catalog_guard;
