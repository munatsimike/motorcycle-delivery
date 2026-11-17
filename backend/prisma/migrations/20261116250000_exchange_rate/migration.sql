-- Internal ZiG-per-USD rate. Wallet configuration stays USD-only.
CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL,
    "rate_version" INTEGER NOT NULL,
    "zig_per_usd" DECIMAL(12, 4) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "exchange_rates_rate_version_key" ON "exchange_rates"("rate_version");

CREATE INDEX "exchange_rates_created_by_id_idx" ON "exchange_rates"("created_by_id");

CREATE UNIQUE INDEX "exchange_rates_one_active_idx" ON "exchange_rates" ("is_active") WHERE "is_active";

ALTER TABLE "exchange_rates"
    ADD CONSTRAINT "exchange_rates_zig_per_usd_chk"
    CHECK ("zig_per_usd" > 0 AND "zig_per_usd" <= 1000000);

ALTER TABLE "exchange_rates"
    ADD CONSTRAINT "exchange_rates_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "exchange_rate_audits" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "previous_version" INTEGER,
    "next_version" INTEGER NOT NULL,
    "previous_zig_per_usd" DECIMAL(12, 4),
    "next_zig_per_usd" DECIMAL(12, 4) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rate_audits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "exchange_rate_audits_next_version_key" ON "exchange_rate_audits"("next_version");

CREATE INDEX "exchange_rate_audits_actor_id_idx" ON "exchange_rate_audits"("actor_id");

CREATE INDEX "exchange_rate_audits_created_at_idx" ON "exchange_rate_audits"("created_at");

ALTER TABLE "exchange_rate_audits"
    ADD CONSTRAINT "exchange_rate_audits_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "exchange_rates" ("id", "rate_version", "zig_per_usd", "is_active", "created_by_id", "created_at")
VALUES ('00000000-0000-7000-8000-000000000033', 1, 33.0000, true, NULL, CURRENT_TIMESTAMP);

ALTER TABLE "deliveries"
    ADD COLUMN "exchange_rate_version" INTEGER,
    ADD COLUMN "exchange_rate_zig_per_usd" DECIMAL(12, 4);

CREATE FUNCTION "deliveries_currency_snapshot_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."currency" IS DISTINCT FROM OLD."currency"
        OR NEW."suggested_price" IS DISTINCT FROM OLD."suggested_price"
        OR NEW."exchange_rate_version" IS DISTINCT FROM OLD."exchange_rate_version"
        OR NEW."exchange_rate_zig_per_usd" IS DISTINCT FROM OLD."exchange_rate_zig_per_usd"
    THEN
        RAISE EXCEPTION 'delivery currency snapshot is immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "deliveries_currency_snapshot_immutable"
    BEFORE UPDATE ON "deliveries"
    FOR EACH ROW
    EXECUTE FUNCTION "deliveries_currency_snapshot_immutable"();
