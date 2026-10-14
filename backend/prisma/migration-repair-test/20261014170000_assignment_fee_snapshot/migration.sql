-- Stores the platform fee accepted with an assignment. Offers that never
-- reach ACCEPTED keep both columns null. Acceptance writes both, including a
-- zero fee. Release, completion, and failure keep the snapshot.
--
-- Historical ACCEPTED, RELEASED, COMPLETED, and FAILED rows are backfilled
-- from the one wallet fee reservation for that delivery and that rider's
-- wallet. OPEN, RELEASED, and CAPTURED reservations are all eligible. The
-- original amount and config_version are copied. A missing or ambiguous
-- match aborts the migration instead of inventing a fee. No historical
-- accepted rows is a no-op.
--
-- Do not drop delivery_assignments_motorcycle_owner_fkey or
-- rider_licence_reviews_image_owner_fkey. Do not drop rider_locations.position,
-- rider_locations_position_gix, or the existing delivery and wallet checks.
-- This script does not change reservation status, wallet balances, ledger
-- entries, or delivery statuses. It does not apply itself.

ALTER TABLE "delivery_assignments"
    ADD COLUMN "accepted_platform_fee" DECIMAL(12,2),
    ADD COLUMN "accepted_fee_config_version" INTEGER;

DO $backfill_accepted_fee$
DECLARE
    historical RECORD;
    match_count integer;
    reserved_amount decimal(12,2);
    reserved_version integer;
BEGIN
    FOR historical IN
        SELECT "id", "delivery_id", "rider_profile_id"
          FROM "delivery_assignments"
         WHERE "status" IN ('ACCEPTED', 'RELEASED', 'COMPLETED', 'FAILED')
    LOOP
        SELECT count(*)
          INTO match_count
          FROM "wallet_fee_reservations" AS reservation
          JOIN "rider_wallets" AS wallet
            ON wallet."id" = reservation."rider_wallet_id"
         WHERE reservation."delivery_id" = historical.delivery_id
           AND wallet."rider_profile_id" = historical.rider_profile_id;

        IF match_count = 0 THEN
            RAISE EXCEPTION 'accepted delivery assignment % has no matching platform fee reservation', historical.id;
        END IF;
        IF match_count <> 1 THEN
            RAISE EXCEPTION 'accepted delivery assignment % has % matching platform fee reservations', historical.id, match_count;
        END IF;

        SELECT reservation."amount", reservation."config_version"
          INTO reserved_amount, reserved_version
          FROM "wallet_fee_reservations" AS reservation
          JOIN "rider_wallets" AS wallet
            ON wallet."id" = reservation."rider_wallet_id"
         WHERE reservation."delivery_id" = historical.delivery_id
           AND wallet."rider_profile_id" = historical.rider_profile_id;

        IF reserved_amount IS NULL
           OR reserved_amount < 0
           OR reserved_version IS NULL
           OR reserved_version < 1 THEN
            RAISE EXCEPTION 'accepted delivery assignment % has an invalid platform fee reservation', historical.id;
        END IF;

        UPDATE "delivery_assignments"
           SET "accepted_platform_fee" = reserved_amount,
               "accepted_fee_config_version" = reserved_version
         WHERE "id" = historical.id;
    END LOOP;
END
$backfill_accepted_fee$;

DO $verify_accepted_fee$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM "delivery_assignments"
         WHERE "status" IN ('ACCEPTED', 'RELEASED', 'COMPLETED', 'FAILED')
           AND (
               "accepted_platform_fee" IS NULL
               OR "accepted_platform_fee" < 0
               OR "accepted_fee_config_version" IS NULL
               OR "accepted_fee_config_version" < 1
           )
    ) THEN
        RAISE EXCEPTION 'accepted delivery assignments exist without a platform fee snapshot';
    END IF;
END
$verify_accepted_fee$;

-- OFFERED, REJECTED, EXPIRED, and CANCELLED never reached ACCEPTED.
-- RELEASED, COMPLETED, and FAILED are reached only from ACCEPTED.
ALTER TABLE "delivery_assignments"
    ADD CONSTRAINT "delivery_assignments_accepted_fee_chk"
    CHECK (
        (
            "status" IN ('OFFERED', 'REJECTED', 'EXPIRED', 'CANCELLED')
            AND "accepted_platform_fee" IS NULL
            AND "accepted_fee_config_version" IS NULL
        )
        OR (
            "status" IN ('ACCEPTED', 'RELEASED', 'COMPLETED', 'FAILED')
            AND "accepted_platform_fee" IS NOT NULL
            AND "accepted_platform_fee" >= 0
            AND "accepted_fee_config_version" IS NOT NULL
            AND "accepted_fee_config_version" >= 1
        )
    );
