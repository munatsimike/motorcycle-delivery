// The backend accepts 4 to 10 digits for SMS and WhatsApp checks.
// Twilio Verify's code length lives on the Verify service, not in this app.
export const VERIFICATION_CODE_PATTERN = /^\d{4,10}$/;

export function isVerificationCode(code: string): boolean {
  return VERIFICATION_CODE_PATTERN.test(code);
}
