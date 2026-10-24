-- V2 commission snapshot on the assignment. Written when a customer accepts a bid.
-- Null until then. This migration does not fill existing rows and does not
-- read suggested_price. V1 accepted_platform_fee columns stay as they are.

ALTER TABLE "delivery_assignments"
    ADD COLUMN "accepted_bid_amount" DECIMAL(12,2),
    ADD COLUMN "accepted_commission_basis_points" INTEGER,
    ADD COLUMN "accepted_v2_commission_rate_version" INTEGER,
    ADD COLUMN "accepted_commission_amount" DECIMAL(12,2);

ALTER TABLE "delivery_assignments"
    ADD CONSTRAINT "delivery_assignments_v2_commission_snapshot_chk"
    CHECK (
        (
            "accepted_bid_amount" IS NULL
            AND "accepted_commission_basis_points" IS NULL
            AND "accepted_v2_commission_rate_version" IS NULL
            AND "accepted_commission_amount" IS NULL
        )
        OR (
            "accepted_bid_amount" IS NOT NULL
            AND "accepted_commission_basis_points" IS NOT NULL
            AND "accepted_v2_commission_rate_version" IS NOT NULL
            AND "accepted_commission_amount" IS NOT NULL
            AND "accepted_bid_amount" >= 0
            AND "accepted_commission_amount" >= 0
            AND "accepted_commission_amount" <= "accepted_bid_amount"
            AND "accepted_commission_basis_points" BETWEEN 0 AND 10000
            AND "accepted_v2_commission_rate_version" >= 1
            AND (
                (("accepted_bid_amount" * 100)::bigint * "accepted_commission_basis_points" + 5000) / 10000
            ) = ("accepted_commission_amount" * 100)::bigint
        )
    );

ALTER TABLE "delivery_assignments"
    ADD CONSTRAINT "delivery_assignments_v2_commission_rate_version_fkey"
    FOREIGN KEY ("accepted_v2_commission_rate_version")
    REFERENCES "v2_commission_rates"("rate_version")
    ON DELETE RESTRICT
    ON UPDATE RESTRICT;

CREATE FUNCTION "delivery_assignments_v2_commission_snapshot_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD."accepted_bid_amount" IS NOT NULL AND (
        NEW."accepted_bid_amount" IS DISTINCT FROM OLD."accepted_bid_amount"
        OR NEW."accepted_commission_basis_points" IS DISTINCT FROM OLD."accepted_commission_basis_points"
        OR NEW."accepted_v2_commission_rate_version" IS DISTINCT FROM OLD."accepted_v2_commission_rate_version"
        OR NEW."accepted_commission_amount" IS DISTINCT FROM OLD."accepted_commission_amount"
    ) THEN
        RAISE EXCEPTION 'V2 commission snapshot is immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "delivery_assignments_v2_commission_snapshot_immutable"
BEFORE UPDATE ON "delivery_assignments"
FOR EACH ROW
EXECUTE FUNCTION "delivery_assignments_v2_commission_snapshot_guard"();
