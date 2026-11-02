-- Append-only rider approval and suspension history for administrators.
-- This does not change approval rules, licence verification, wallets, or
-- delivery assignment. Do not store passwords, tokens, or licence images.

CREATE TYPE "rider_approval_audit_action" AS ENUM ('APPROVE', 'SUSPEND');

CREATE TABLE "rider_approval_audits" (
    "id" UUID NOT NULL,
    "rider_profile_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" "rider_approval_audit_action" NOT NULL,
    "previous_approval_status" "rider_approval_status" NOT NULL,
    "new_approval_status" "rider_approval_status" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rider_approval_audits_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "rider_approval_audits"
    ADD CONSTRAINT "rider_approval_audits_action_chk"
    CHECK (
        (
            "action" = 'APPROVE'::"rider_approval_audit_action"
            AND "new_approval_status" = 'APPROVED'::"rider_approval_status"
            AND "previous_approval_status" IN (
                'PENDING'::"rider_approval_status",
                'SUSPENDED'::"rider_approval_status"
            )
        )
        OR (
            "action" = 'SUSPEND'::"rider_approval_audit_action"
            AND "new_approval_status" = 'SUSPENDED'::"rider_approval_status"
            AND "previous_approval_status" = 'APPROVED'::"rider_approval_status"
        )
    );

ALTER TABLE "rider_approval_audits"
    ADD CONSTRAINT "rider_approval_audits_rider_profile_id_fkey"
    FOREIGN KEY ("rider_profile_id") REFERENCES "rider_profiles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rider_approval_audits"
    ADD CONSTRAINT "rider_approval_audits_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "rider_approval_audits_rider_profile_id_created_at_idx"
    ON "rider_approval_audits"("rider_profile_id", "created_at");

CREATE INDEX "rider_approval_audits_actor_id_idx"
    ON "rider_approval_audits"("actor_id");

CREATE FUNCTION "rider_approval_audits_reject_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'rider approval audits are append-only';
END;
$$;

CREATE TRIGGER "rider_approval_audits_append_only"
    BEFORE UPDATE OR DELETE ON "rider_approval_audits"
    FOR EACH ROW
    EXECUTE FUNCTION "rider_approval_audits_reject_mutation"();
