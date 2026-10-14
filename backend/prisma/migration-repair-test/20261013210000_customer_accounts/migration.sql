-- Phase 5A customer accounts. One passwordless user can be a rider, a
-- customer, or both. Deliveries belong to customer_accounts, not users.
-- users.role is unchanged. This migration does not create staff membership,
-- and it does not alter rider, admin, assignment, or passwordless checks.
--
-- Do not drop delivery_assignments_motorcycle_owner_fkey or
-- rider_licence_reviews_image_owner_fkey. The only foreign key removed
-- below is deliveries_customer_id_fkey, and it is replaced with one that
-- references customer_accounts.

CREATE TYPE "customer_account_kind" AS ENUM ('INDIVIDUAL', 'BUSINESS');

CREATE TABLE "customer_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "customer_account_kind" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "contact_name" VARCHAR(200),
    "address" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_accounts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_kind_chk" CHECK (
    (
        "kind" = 'INDIVIDUAL'::"customer_account_kind"
        AND "contact_name" IS NULL
        AND btrim("name") <> ''
        AND btrim("address") <> ''
    )
    OR (
        "kind" = 'BUSINESS'::"customer_account_kind"
        AND "contact_name" IS NOT NULL
        AND btrim("contact_name") <> ''
        AND btrim("name") <> ''
        AND btrim("address") <> ''
    )
);

CREATE UNIQUE INDEX "customer_accounts_user_id_key" ON "customer_accounts"("user_id");

ALTER TABLE "customer_accounts"
    ADD CONSTRAINT "customer_accounts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Legacy customer users registered before an address was collected.
INSERT INTO "customer_accounts" (
    "id",
    "user_id",
    "kind",
    "name",
    "contact_name",
    "address",
    "created_at",
    "updated_at"
)
SELECT
    gen_random_uuid(),
    "id",
    'INDIVIDUAL'::"customer_account_kind",
    "full_name",
    NULL,
    'Address not yet provided',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "users"
WHERE "role" = 'CUSTOMER'::"user_role";

-- Snapshot the user id currently stored in deliveries.customer_id before it
-- is rewritten. Later checks join through this snapshot. Comparing the new
-- value with users.id or with any customer_accounts.id would be wrong when
-- a new account id happens to equal an old user id.
CREATE TEMP TABLE "delivery_customer_sources" (
    "delivery_id" UUID PRIMARY KEY,
    "source_user_id" UUID NOT NULL
);

INSERT INTO "delivery_customer_sources" ("delivery_id", "source_user_id")
SELECT "id", "customer_id"
FROM "deliveries";

DO $$
DECLARE
    invalid_count integer;
BEGIN
    SELECT count(*) INTO invalid_count
    FROM "delivery_customer_sources" AS source
    WHERE NOT EXISTS (
        SELECT 1
        FROM "users" AS customer_user
        WHERE customer_user."id" = source."source_user_id"
    );
    IF invalid_count > 0 THEN
        RAISE EXCEPTION
            'Cannot migrate deliveries: % delivery row(s) reference a user that does not exist',
            invalid_count;
    END IF;

    SELECT count(*) INTO invalid_count
    FROM "delivery_customer_sources" AS source
    JOIN "users" AS customer_user ON customer_user."id" = source."source_user_id"
    WHERE customer_user."role" <> 'CUSTOMER'::"user_role";
    IF invalid_count > 0 THEN
        RAISE EXCEPTION
            'Cannot migrate deliveries: % delivery row(s) reference a user whose role is not CUSTOMER',
            invalid_count;
    END IF;

    SELECT count(*) INTO invalid_count
    FROM "delivery_customer_sources" AS source
    WHERE NOT EXISTS (
        SELECT 1
        FROM "customer_accounts" AS account
        WHERE account."user_id" = source."source_user_id"
    );
    IF invalid_count > 0 THEN
        RAISE EXCEPTION
            'Cannot migrate deliveries: % delivery row(s) cannot be mapped to a customer account',
            invalid_count;
    END IF;
END $$;

ALTER TABLE "deliveries" DROP CONSTRAINT "deliveries_customer_id_fkey";

UPDATE "deliveries" AS delivery
SET "customer_id" = account."id"
FROM "delivery_customer_sources" AS source
JOIN "customer_accounts" AS account
    ON account."user_id" = source."source_user_id"
WHERE delivery."id" = source."delivery_id";

DO $$
DECLARE
    invalid_count integer;
    delivery_count integer;
    source_count integer;
BEGIN
    SELECT count(*) INTO delivery_count FROM "deliveries";
    SELECT count(*) INTO source_count FROM "delivery_customer_sources";

    SELECT count(*) INTO invalid_count
    FROM "deliveries" AS delivery
    WHERE NOT EXISTS (
        SELECT 1
        FROM "delivery_customer_sources" AS source
        JOIN "customer_accounts" AS account
            ON account."user_id" = source."source_user_id"
        WHERE source."delivery_id" = delivery."id"
          AND delivery."customer_id" = account."id"
    );

    IF delivery_count <> source_count OR invalid_count > 0 THEN
        RAISE EXCEPTION
            'Cannot migrate deliveries: % delivery row(s) still reference an old user id after customer account mapping',
            GREATEST(invalid_count, abs(delivery_count - source_count));
    END IF;
END $$;

ALTER TABLE "deliveries"
    ADD CONSTRAINT "deliveries_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customer_accounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "auth_challenges" ADD COLUMN "account_kind" "customer_account_kind";
ALTER TABLE "auth_challenges" ADD COLUMN "address" VARCHAR(500);
ALTER TABLE "auth_challenges" ADD COLUMN "business_name" VARCHAR(200);
