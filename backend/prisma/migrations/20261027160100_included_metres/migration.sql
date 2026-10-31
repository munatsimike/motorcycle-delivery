-- The base fee covers included_metres. The per-kilometre rate applies only beyond it.
-- Existing rows stay null because they use another model.
-- Fee, version, and distance columns are not rewritten.

ALTER TABLE "delivery_pricing_configs"
    ADD COLUMN "included_metres" INTEGER;

ALTER TABLE "delivery_pricing_configs"
    ADD CONSTRAINT "delivery_pricing_configs_included_metres_chk"
    CHECK (
        (
            "pricing_model" = 'INCLUDED_DISTANCE'
            AND "included_metres" IS NOT NULL
            AND "included_metres" > 0
            AND "included_metres" >= "minimum_trip_metres"
            AND "included_metres" <= "maximum_trip_metres"
        )
        OR (
            "pricing_model" <> 'INCLUDED_DISTANCE'
            AND "included_metres" IS NULL
        )
    );
