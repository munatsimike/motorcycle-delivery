-- Milestone 3. Customer acceptance sets the delivery to RIDER_ASSIGNED.
-- An ACCEPTED V2 assignment may leave the V1 platform-fee columns null when
-- the four commission snapshot columns are set. V1 acceptOffer still writes
-- those fee columns. This file does not add the live-Express index, does not
-- drop the one-accepted-per-rider index, and does not insert or update rows.

ALTER TYPE "delivery_status" ADD VALUE IF NOT EXISTS 'RIDER_ASSIGNED' AFTER 'ASSIGNED';

ALTER TABLE "delivery_assignments" ADD COLUMN "service_class" "service_class";

ALTER TABLE "delivery_assignments" DROP CONSTRAINT "delivery_assignments_accepted_fee_chk";

ALTER TABLE "delivery_assignments"
    ADD CONSTRAINT "delivery_assignments_accepted_fee_chk"
    CHECK (
        (
            "status" IN (
                'OFFERED'::"assignment_status",
                'REJECTED'::"assignment_status",
                'EXPIRED'::"assignment_status",
                'CANCELLED'::"assignment_status"
            )
            AND "accepted_platform_fee" IS NULL
            AND "accepted_fee_config_version" IS NULL
            AND "accepted_bid_amount" IS NULL
        )
        OR (
            "status" IN (
                'ACCEPTED'::"assignment_status",
                'RELEASED'::"assignment_status",
                'COMPLETED'::"assignment_status",
                'FAILED'::"assignment_status"
            )
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
