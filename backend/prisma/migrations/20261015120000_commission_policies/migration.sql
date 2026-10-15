-- Commission models
CREATE TYPE "commission_model" AS ENUM ('ON_COMPLETION', 'ON_ACCEPTANCE');

-- Versioned global commission policy
CREATE TABLE "commission_policies" (
    "id" UUID NOT NULL,
    "policy_version" INTEGER NOT NULL,
    "model" "commission_model" NOT NULL DEFAULT 'ON_COMPLETION',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "commission_policies_policy_version_key"
    ON "commission_policies"("policy_version");

CREATE INDEX "commission_policies_created_by_id_idx"
    ON "commission_policies"("created_by_id");

-- Only one policy may be active at a time
CREATE UNIQUE INDEX "commission_policies_one_active_idx"
    ON "commission_policies" ((true))
    WHERE "is_active" = true;

-- Preserve commission policy at the time of acceptance
ALTER TABLE "delivery_assignments"
    ADD COLUMN "accepted_commission_model" "commission_model",
    ADD COLUMN "accepted_commission_policy_version" INTEGER;

-- Auditable wallet refunds
ALTER TYPE "wallet_entry_type" ADD VALUE 'PLATFORM_FEE_REFUND';

-- Existing assignments retain NULL snapshots and use ON_COMPLETION.
-- Start with the existing commission behavior.
INSERT INTO "commission_policies" (
    "id",
    "policy_version",
    "model",
    "is_active"
)
VALUES (
    gen_random_uuid(),
    1,
    'ON_COMPLETION',
    true
);

