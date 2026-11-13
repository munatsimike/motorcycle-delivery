import { describe, expect, it } from 'vitest';
import { fitOtpDigits, isVerificationCode } from './verificationCode';

describe('verification code', () => {
  it('accepts the shared private-test code in the existing six boxes', () => {
    expect(isVerificationCode('000000')).toBe(true);
    expect(fitOtpDigits('000000')).toBe('000000');
  });
});
