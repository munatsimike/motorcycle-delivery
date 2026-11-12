-- Customer and rider accounts authenticate with WhatsApp only.
-- password_hash stays on users because admin email/password sign-in uses the same column.
-- Admins are outside users_account_credential_chk and are not updated here.

UPDATE "users"
SET "password_hash" = NULL
WHERE "role" IN ('CUSTOMER'::"user_role", 'RIDER'::"user_role")
  AND "password_hash" IS NOT NULL;

ALTER TABLE "users" DROP CONSTRAINT "users_account_credential_chk";

-- An active customer or rider needs a verified phone and must not store a password.
-- Pending registration may omit phone_verified_at. Admins stay outside this check.
ALTER TABLE "users" ADD CONSTRAINT "users_account_credential_chk" CHECK (
    (
        "role" IN ('CUSTOMER'::"user_role", 'RIDER'::"user_role")
        AND "password_hash" IS NULL
        AND (
            "account_status" <> 'ACTIVE'::"account_status"
            OR "phone_verified_at" IS NOT NULL
        )
    )
    OR "role" = 'ADMIN'::"user_role"
);

DROP TABLE "password_login_attempts";
