-- WhatsApp registration and password recovery.
-- Historical migrations are unchanged. Do not drop V1 indexes from this file.

ALTER TYPE "auth_purpose" ADD VALUE 'WHATSAPP_REGISTRATION';
ALTER TYPE "auth_purpose" ADD VALUE 'PASSWORD_RECOVERY';

CREATE TYPE "verification_channel" AS ENUM ('SMS', 'WHATSAPP');

ALTER TABLE "auth_challenges" ADD COLUMN "channel" "verification_channel" NOT NULL DEFAULT 'SMS';

ALTER TABLE "users" ADD COLUMN "whatsapp_consent_at" TIMESTAMPTZ(6);
