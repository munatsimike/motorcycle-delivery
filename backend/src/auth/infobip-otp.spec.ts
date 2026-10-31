import { describe, expect, it } from 'vitest';
import { generateInfobipOtp, hashInfobipOtp, verifyInfobipOtp } from './infobip-otp.js';

const SECRET = 's'.repeat(32);
const INPUT = {
  challengeId: 'challenge-1',
  phone: '+263771234567',
  purpose: 'WHATSAPP_REGISTRATION',
  code: '654321',
};

describe('Infobip OTP hash', () => {
  it('generates a six-digit code and verifies only the bound challenge', () => {
    const code = generateInfobipOtp();
    expect(code).toMatch(/^\d{6}$/);
    const hash = hashInfobipOtp(SECRET, INPUT);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(INPUT.code);
    expect(verifyInfobipOtp(SECRET, INPUT, hash)).toBe(true);
    expect(verifyInfobipOtp(SECRET, { ...INPUT, code: '000000' }, hash)).toBe(false);
    expect(verifyInfobipOtp(SECRET, { ...INPUT, phone: '+263771234568' }, hash)).toBe(false);
    expect(verifyInfobipOtp(SECRET, { ...INPUT, purpose: 'LOGIN' }, hash)).toBe(false);
    expect(verifyInfobipOtp(SECRET, { ...INPUT, challengeId: 'challenge-2' }, hash)).toBe(false);
    expect(verifyInfobipOtp(SECRET, { ...INPUT, code: '65432' }, hash)).toBe(false);
  });
});
