export const OTP_COOLDOWN_MS = 60_000;
export const OTP_PHONE_HOURLY_LIMIT = 5;
export const OTP_IP_HOURLY_LIMIT = 20;
export const OTP_MAX_CHECK_ATTEMPTS = 5;
export const OTP_CHALLENGE_TTL_MS = 10 * 60_000;
// Local mock OTP codes expire sooner than a WhatsApp challenge. The WhatsApp
// provider does not use this value.
export const DEV_OTP_TTL_MS = 5 * 60_000;
export const REGISTRATION_PROOF_TTL_MS = 15 * 60_000;
export const OTP_LOCK_MS = 15 * 60_000;
// Customer and rider refresh tokens expire after this much inactivity.
// A successful refresh moves the session family forward by the same amount.
export const REFRESH_INACTIVITY_MS = 30 * 24 * 60 * 60 * 1000;
// Admin sessions keep a fixed family lifetime and do not slide on refresh.
export const REFRESH_ABSOLUTE_MS = 90 * 24 * 60 * 60 * 1000;
// A second refresh of a token just rotated by a concurrent request is rejected
// without revoking the new session. Reuse after this window revokes the family.
export const REFRESH_REUSE_GRACE_MS = 10_000;
export const ACCESS_TOKEN_TTL_SECONDS = 900;
