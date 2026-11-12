-- Global V2 commission percentage. Separate from commission_policies and wallet_configs.
-- No seeded percentage. One active row. Basis points run from 0 through 10000.

CREATE TABLE "v2_commission_rates" (
    "id" UUID NOT NULL,
    "rate_version" INTEGER NOT NULL,
    "basis_points" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "v2_commission_rates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "v2_commission_rates_basis_points_chk" CHECK ("basis_points" >= 0 AND "basis_points" <= 10000)
);

CREATE UNIQUE INDEX "v2_commission_rates_rate_version_key"
    ON "v2_commission_rates"("rate_version");

CREATE INDEX "v2_commission_rates_created_by_id_idx"
    ON "v2_commission_rates"("created_by_id");

CREATE UNIQUE INDEX "v2_commission_rates_one_active_idx"
    ON "v2_commission_rates" ((true))
    WHERE "is_active" = true;

ALTER TABLE "v2_commission_rates"
    ADD CONSTRAINT "v2_commission_rates_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "v2_commission_rate_audits" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "previous_version" INTEGER,
    "next_version" INTEGER NOT NULL,
    "previous_basis_points" INTEGER,
    "next_basis_points" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "v2_commission_rate_audits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "v2_commission_rate_audits_basis_points_chk" CHECK (
        ("previous_basis_points" IS NULL OR ("previous_basis_points" >= 0 AND "previous_basis_points" <= 10000))
        AND "next_basis_points" >= 0
        AND "next_basis_points" <= 10000
    )
);

-- One audit row per published rate version. The unique rate_version index
-- does not constrain this table, so a second history row could otherwise
-- claim the same version. previous_version stays non-unique because the
-- first publication stores null.
CREATE UNIQUE INDEX "v2_commission_rate_audits_next_version_key"
    ON "v2_commission_rate_audits"("next_version");

CREATE INDEX "v2_commission_rate_audits_actor_id_idx"
    ON "v2_commission_rate_audits"("actor_id");

ALTER TABLE "v2_commission_rate_audits"
    ADD CONSTRAINT "v2_commission_rate_audits_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
