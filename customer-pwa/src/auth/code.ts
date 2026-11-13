export const VERIFICATION_CODE_PATTERN = /^\d{4,10}$/;
export const OTP_BOX_COUNT = 6;

export function isVerificationCode(code: string): boolean {
  return VERIFICATION_CODE_PATTERN.test(code);
}

export function fitOtpDigits(value: string): string {
  return value.replace(/\D/g, '').slice(0, OTP_BOX_COUNT);
}
