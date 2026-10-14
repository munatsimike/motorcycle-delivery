-- Phase 6B progressive dispatch. Adds one current GPS point per rider, durable
-- search rounds, and the columns needed to accept an offer idempotently.
-- This script does not apply itself. It does not edit earlier migrations.
--
-- delivery_assignments_one_open_offer_per_rider_idx stays. It is unique on
-- (delivery_id, rider_profile_id) only while status is OFFERED or ACCEPTED.
-- A RELEASED row does not occupy it, so a later wave could otherwise offer the
-- same rider again. The dispatcher excludes riders who have ever released that
-- delivery. Do not drop the index to make that rule.
--
-- Distance uses geography(Point,4326) and a GiST index. Prisma stores only the
-- decimal coordinates. Do not drop rider_locations.position or
-- rider_locations_position_gix in a later generated diff.
--
-- Pricing remains the haversine snapshot on the delivery. This migration does
-- not change delivery_pricing_configs or wallet top-up tables. It does not
-- post platform-fee ledger rows.
--
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

CREATE TYPE "dispatch_round_status" AS ENUM ('PENDING', 'COMPLETED');

CREATE TABLE "rider_locations" (
    "rider_profile_id" UUID NOT NULL,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "position" geography(Point,4326) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rider_locations_pkey" PRIMARY KEY ("rider_profile_id")
);

CREATE INDEX "rider_locations_position_gix" ON "rider_locations" USING GIST ("position");

ALTER TABLE "rider_locations"
    ADD CONSTRAINT "rider_locations_rider_profile_id_fkey"
    FOREIGN KEY ("rider_profile_id") REFERENCES "rider_profiles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rider_locations"
    ADD CONSTRAINT "rider_locations_coordinate_chk"
    CHECK (
        "latitude" >= -90
        AND "latitude" <= 90
        AND "longitude" >= -180
        AND "longitude" <= 180
    );

CREATE TABLE "delivery_dispatch_rounds" (
    "id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "search_generation" INTEGER NOT NULL,
    "round_number" INTEGER NOT NULL,
    "radius_metres" INTEGER NOT NULL,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "dispatch_round_status" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "delivery_dispatch_rounds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "delivery_dispatch_rounds_generation_round_key"
    ON "delivery_dispatch_rounds"("delivery_id", "search_generation", "round_number");

CREATE INDEX "delivery_dispatch_rounds_status_due_at_idx"
    ON "delivery_dispatch_rounds"("status", "due_at");

ALTER TABLE "delivery_dispatch_rounds"
    ADD CONSTRAINT "delivery_dispatch_rounds_delivery_id_fkey"
    FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "delivery_dispatch_rounds"
    ADD CONSTRAINT "delivery_dispatch_rounds_round_chk"
    CHECK (
        "search_generation" >= 1
        AND (
            ("round_number" = 1 AND "radius_metres" = 2000)
            OR ("round_number" = 2 AND "radius_metres" = 5000)
            OR ("round_number" = 3 AND "radius_metres" = 10000)
        )
    );

ALTER TABLE "delivery_dispatch_rounds"
    ADD CONSTRAINT "delivery_dispatch_rounds_status_chk"
    CHECK (
        ("status" = 'PENDING'::"dispatch_round_status" AND "completed_at" IS NULL)
        OR ("status" = 'COMPLETED'::"dispatch_round_status" AND "completed_at" IS NOT NULL)
    );

ALTER TABLE "deliveries"
    ADD COLUMN "search_generation" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "deliveries"
    ADD CONSTRAINT "deliveries_search_generation_chk"
    CHECK ("search_generation" >= 0);

ALTER TABLE "delivery_assignments"
    ADD COLUMN "search_generation" INTEGER,
    ADD COLUMN "idempotency_key" VARCHAR(200),
    ADD COLUMN "payload_hash" CHAR(64);

CREATE UNIQUE INDEX "delivery_assignments_idempotency_key_key"
    ON "delivery_assignments"("idempotency_key");

ALTER TABLE "delivery_assignments"
    ADD CONSTRAINT "delivery_assignments_accept_idempotency_chk"
    CHECK (
        ("idempotency_key" IS NULL AND "payload_hash" IS NULL)
        OR (
            "idempotency_key" IS NOT NULL
            AND "payload_hash" IS NOT NULL
            AND char_length("idempotency_key") BETWEEN 1 AND 200
        )
    );

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
