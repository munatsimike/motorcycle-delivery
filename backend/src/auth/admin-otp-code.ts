import {
  createHmac,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

export function generateAdminOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function getOtpSecret(): string {
  const secret = process.env.ADMIN_OTP_HMAC_SECRET;

  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('Admin OTP HMAC secret is not configured');
  }

  return secret;
}

export function hashAdminOtp(
  challengeId: string,
  code: string,
): string {
  return createHmac('sha256', getOtpSecret())
    .update(`${challengeId}:${code}`)
    .digest('hex');
}

export function verifyAdminOtp(
  challengeId: string,
  code: string,
  expectedHash: string,
): boolean {
  if (!/^\d{6}$/.test(code) || !/^[a-f0-9]{64}$/i.test(expectedHash)) {
    return false;
  }

  const actual = Buffer.from(hashAdminOtp(challengeId, code), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');

  return timingSafeEqual(actual, expected);
}
