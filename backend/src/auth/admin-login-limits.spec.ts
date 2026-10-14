import { describe, expect, it } from 'vitest';
import { adminOtpRequestAllowed } from './admin-login-limits.js';

describe('Admin OTP request limits', () => {
  const now = new Date('2026-10-14T20:00:00Z');

  const minutesAgo = (minutes: number) => ({
    createdAt: new Date(now.getTime() - minutes * 60_000),
  });

  it('allows the first OTP request', () => {
    expect(adminOtpRequestAllowed([], now)).toBe(true);
  });

  it('blocks another request during the 60-second cooldown', () => {
    expect(adminOtpRequestAllowed([minutesAgo(0.5)], now)).toBe(false);
  });

  it('allows another request after the cooldown', () => {
    expect(adminOtpRequestAllowed([minutesAgo(2)], now)).toBe(true);
  });

  it('blocks the sixth request within an hour', () => {
    const challenges = [2, 10, 20, 30, 40].map(minutesAgo);

    expect(adminOtpRequestAllowed(challenges, now)).toBe(false);
  });

  it('ignores challenges older than one hour', () => {
    const challenges = [61, 70, 80, 90, 100].map(minutesAgo);

    expect(adminOtpRequestAllowed(challenges, now)).toBe(true);
  });

  it('uses the most recent challenge for cooldown checks', () => {
    const challenges = [30, 0.5, 15].map(minutesAgo);

    expect(adminOtpRequestAllowed(challenges, now)).toBe(false);
  });
});
