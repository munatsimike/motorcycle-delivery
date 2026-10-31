-- Keyed HMAC of a backend-generated WhatsApp code.
-- Existing Twilio challenges keep a null hash and their provider reference.

ALTER TABLE "auth_challenges" ADD COLUMN "code_hash" CHAR(64);

ALTER TABLE "auth_challenges" ALTER COLUMN "twilio_sid" TYPE VARCHAR(128);
