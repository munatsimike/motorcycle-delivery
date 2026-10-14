CREATE TABLE "admin_login_attempts" (
    "id" UUID NOT NULL,
    "ip_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_login_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_login_attempts_ip_hash_created_at_idx"
    ON "admin_login_attempts"("ip_hash", "created_at");
