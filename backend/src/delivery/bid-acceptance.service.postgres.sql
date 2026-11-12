-- Constraints Prisma db push cannot represent. Applied only to the disposable database.

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

ALTER TABLE "delivery_assignments"
    ADD CONSTRAINT "delivery_assignments_accepted_fee_chk"
    CHECK (
        (
            "status" IN ('OFFERED', 'REJECTED', 'EXPIRED', 'CANCELLED')
            AND "accepted_platform_fee" IS NULL
            AND "accepted_fee_config_version" IS NULL
            AND "accepted_bid_amount" IS NULL
        )
        OR (
            "status" IN ('ACCEPTED', 'RELEASED', 'COMPLETED', 'FAILED')
            AND (
                (
                    "accepted_platform_fee" IS NOT NULL
                    AND "accepted_platform_fee" >= 0
                    AND "accepted_fee_config_version" IS NOT NULL
                    AND "accepted_fee_config_version" >= 1
                )
                OR "accepted_bid_amount" IS NOT NULL
            )
        )
    );

ALTER TABLE "delivery_assignments"
    ADD CONSTRAINT "delivery_assignments_motorcycle_chk"
    CHECK (
        (
            "status" IN ('OFFERED', 'REJECTED', 'EXPIRED', 'CANCELLED')
            AND "motorcycle_id" IS NULL
        )
        OR (
            "status" IN ('ACCEPTED', 'RELEASED', 'COMPLETED', 'FAILED')
            AND "motorcycle_id" IS NOT NULL
        )
    );

ALTER TABLE "delivery_assignments"
    ADD CONSTRAINT "delivery_assignments_motorcycle_owner_fkey"
    FOREIGN KEY ("motorcycle_id", "rider_profile_id")
    REFERENCES "motorcycles" ("id", "rider_profile_id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

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

CREATE UNIQUE INDEX "delivery_assignments_one_accepted_per_delivery_idx"
    ON "delivery_assignments" ("delivery_id")
    WHERE "status" = 'ACCEPTED';

CREATE UNIQUE INDEX "delivery_assignments_one_open_offer_per_rider_idx"
    ON "delivery_assignments" ("delivery_id", "rider_profile_id")
    WHERE "status" IN ('OFFERED', 'ACCEPTED');

CREATE UNIQUE INDEX "bids_one_accepted_per_delivery_idx"
    ON "bids" ("delivery_id")
    WHERE "status" = 'ACCEPTED' AND "closed_at" IS NULL;

CREATE UNIQUE INDEX "wallet_fee_reservations_one_open_per_delivery_idx"
    ON "wallet_fee_reservations" ("delivery_id")
    WHERE "status" = 'OPEN' AND "delivery_id" IS NOT NULL;

ALTER TABLE "wallet_fee_reservations"
    ADD CONSTRAINT "wallet_fee_reservations_status_chk"
    CHECK (
        "amount" > 0
        AND "currency" = 'USD'
        AND "config_version" >= 1
        AND "status" = 'OPEN'
        AND "released_at" IS NULL
        AND "captured_at" IS NULL
    );

CREATE UNIQUE INDEX "v2_commission_rates_one_active_idx"
    ON "v2_commission_rates" ((true))
    WHERE "is_active" = true;
