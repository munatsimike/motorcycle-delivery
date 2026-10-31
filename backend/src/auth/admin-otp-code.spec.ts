import {
  generateAdminOtp,
  hashAdminOtp,
  verifyAdminOtp,
} from './admin-otp-code.js';

describe('Admin OTP security', () => {
  const originalSecret = process.env.ADMIN_OTP_HMAC_SECRET;

  beforeEach(() => {
    process.env.ADMIN_OTP_HMAC_SECRET =
      'test-only-admin-otp-secret-at-least-32-characters';
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.ADMIN_OTP_HMAC_SECRET;
    } else {
      process.env.ADMIN_OTP_HMAC_SECRET = originalSecret;
    }
  });

  it('generates six-digit numeric codes', () => {
    for (let i = 0; i < 100; i++) {
      expect(generateAdminOtp()).toMatch(/^\d{6}$/);
    }
  });

  it('verifies a correct code', () => {
    const hash = hashAdminOtp('challenge-1', '123456');

    expect(verifyAdminOtp('challenge-1', '123456', hash)).toBe(true);
  });

  it('rejects an incorrect code', () => {
    const hash = hashAdminOtp('challenge-1', '123456');

    expect(verifyAdminOtp('challenge-1', '654321', hash)).toBe(false);
  });

  it('rejects a code from another challenge', () => {
    const hash = hashAdminOtp('challenge-1', '123456');

    expect(verifyAdminOtp('challenge-2', '123456', hash)).toBe(false);
  });

  it('rejects malformed codes and hashes', () => {
    const hash = hashAdminOtp('challenge-1', '123456');

    expect(verifyAdminOtp('challenge-1', '12345', hash)).toBe(false);
    expect(verifyAdminOtp('challenge-1', 'abcdef', hash)).toBe(false);
    expect(verifyAdminOtp('challenge-1', '123456', 'invalid')).toBe(false);
  });

  it('rejects a missing HMAC secret', () => {
    delete process.env.ADMIN_OTP_HMAC_SECRET;

    expect(() => hashAdminOtp('challenge-1', '123456')).toThrow(
      'Admin OTP HMAC secret is not configured',
    );
  });
});
