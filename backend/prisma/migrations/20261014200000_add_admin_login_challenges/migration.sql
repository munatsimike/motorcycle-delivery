CREATE TABLE "admin_login_challenges" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "check_attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_login_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_login_challenges_admin_user_id_created_at_idx"
    ON "admin_login_challenges"("admin_user_id", "created_at");

ALTER TABLE "admin_login_challenges"
    ADD CONSTRAINT "admin_login_challenges_admin_user_id_fkey"
    FOREIGN KEY ("admin_user_id")
    REFERENCES "users"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
