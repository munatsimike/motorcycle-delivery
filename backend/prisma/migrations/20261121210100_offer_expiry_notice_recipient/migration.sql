-- CUSTOMER_CANCELLED is sent to the accepted rider. RIDER_CANCELLED stays
-- on the customer branch of this check.

ALTER TABLE "v2_outbox_events" DROP CONSTRAINT "v2_outbox_events_recipient_chk";

ALTER TABLE "v2_outbox_events"
    ADD CONSTRAINT "v2_outbox_events_recipient_chk"
    CHECK (
        "attempt_count" >= 0
        AND (
            (
                "event_type" IN (
                    'BID_ACCEPTED'::"v2_outbox_event_type",
                    'ACCOUNT_APPROVED'::"v2_outbox_event_type",
                    'BID_EXPIRED'::"v2_outbox_event_type",
                    'CUSTOMER_CANCELLED'::"v2_outbox_event_type"
                )
                AND "rider_profile_id" IS NOT NULL
                AND "customer_account_id" IS NULL
            )
            OR (
                "event_type" = 'RIDER_OPPORTUNITY'::"v2_outbox_event_type"
                AND "rider_profile_id" IS NULL
                AND "customer_account_id" IS NULL
                AND "delivery_id" IS NOT NULL
            )
            OR (
                "event_type" NOT IN (
                    'BID_ACCEPTED'::"v2_outbox_event_type",
                    'ACCOUNT_APPROVED'::"v2_outbox_event_type",
                    'BID_EXPIRED'::"v2_outbox_event_type",
                    'CUSTOMER_CANCELLED'::"v2_outbox_event_type",
                    'RIDER_OPPORTUNITY'::"v2_outbox_event_type"
                )
                AND "customer_account_id" IS NOT NULL
                AND "rider_profile_id" IS NULL
            )
        )
    );
