import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export function generateInfobipOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function hashInfobipOtp(
  secret: string,
  input: { challengeId: string; phone: string; purpose: string; code: string },
): string {
  return createHmac('sha256', secret)
    .update(`${input.challengeId}\0${input.phone}\0${input.purpose}\0${input.code}`)
    .digest('hex');
}

export function verifyInfobipOtp(
  secret: string,
  input: { challengeId: string; phone: string; purpose: string; code: string },
  expectedHash: string,
): boolean {
  if (!/^\d{6}$/.test(input.code) || !/^[a-f0-9]{64}$/i.test(expectedHash)) {
    return false;
  }
  const actual = Buffer.from(hashInfobipOtp(secret, input), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return timingSafeEqual(actual, expected);
}
