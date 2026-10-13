const ZIMBABWE_MOBILE = /^\+2637\d{8}$/;
const DUTCH_MOBILE = /^\+316\d{8}$/;

export class InvalidPhoneNumberError extends Error {
  constructor() {
    super('Enter a valid Zimbabwe mobile number');
    this.name = 'InvalidPhoneNumberError';
  }
}

export function normalizeZimbabweMobile(input: string): string {
  const e164 = zimbabweE164(compactDigits(input));
  if (!e164) {
    throw new InvalidPhoneNumberError();
  }
  return e164;
}

// Registration, login, and OTP verification share this check. Dutch mobiles
// are a local testing aid and stay disabled outside development.
export function normalizeAuthPhone(input: string): string {
  const digits = compactDigits(input);
  if (dutchTestNumbersAllowed()) {
    const dutch = dutchTestE164(digits);
    if (dutch && DUTCH_MOBILE.test(dutch)) {
      return dutch;
    }
  }
  return normalizeStoredDigits(digits);
}

function dutchTestNumbersAllowed(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.ALLOW_TEST_NL_PHONE_NUMBERS === 'true';
}

function normalizeStoredDigits(digits: string): string {
  const e164 = zimbabweE164(digits);
  if (!e164) {
    throw new InvalidPhoneNumberError();
  }
  return e164;
}

function compactDigits(input: string): string {
  const compact = input.trim().replace(/[\s().-]/g, '');
  if (!compact) {
    throw new InvalidPhoneNumberError();
  }
  const digits = compact.startsWith('+') ? compact.slice(1) : compact;
  if (!/^\d+$/.test(digits)) {
    throw new InvalidPhoneNumberError();
  }
  return digits;
}

function dutchTestE164(digits: string): string | null {
  if (digits.startsWith('00')) {
    return dutchFromCountryCode(digits.slice(2));
  }
  return dutchFromCountryCode(digits) ?? dutchFromNational(digits);
}

function dutchFromCountryCode(digits: string): string | null {
  if (/^316\d{8}$/.test(digits)) {
    return `+${digits}`;
  }
  if (/^3106\d{8}$/.test(digits)) {
    return `+316${digits.slice(4)}`;
  }
  return null;
}

function dutchFromNational(digits: string): string | null {
  if (/^06\d{8}$/.test(digits)) {
    return `+316${digits.slice(2)}`;
  }
  if (/^6\d{8}$/.test(digits)) {
    return `+31${digits}`;
  }
  return null;
}

function zimbabweE164(digits: string): string | null {
  let national = digits;
  if (national.startsWith('00')) {
    national = national.slice(2);
  }
  if (national.startsWith('0')) {
    national = `263${national.slice(1)}`;
  } else if (national.length === 9 && national.startsWith('7')) {
    national = `263${national}`;
  }
  if (national.startsWith('2630')) {
    national = `263${national.slice(4)}`;
  }
  const e164 = `+${national}`;
  return ZIMBABWE_MOBILE.test(e164) ? e164 : null;
}
