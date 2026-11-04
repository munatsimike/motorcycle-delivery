const ZIMBABWE_MOBILE = /^\+2637\d{8}$/;

export function looksLikeDutchPhoneEntry(phone: string): boolean {
  const cleaned = phone.replace(/[\s()-]/g, '');
  return cleaned.startsWith('+31') || cleaned.startsWith('0031') || cleaned.startsWith('316') || /^0?6\d{0,8}$/.test(cleaned);
}

export function normalizeRiderPhone(input: string): string {
  const compact = input.trim().replace(/[\s().-]/g, '');
  if (!compact) {
    throw new Error('Enter a valid Zimbabwe mobile number');
  }
  const digits = compact.startsWith('+') ? compact.slice(1) : compact;
  if (!/^\d+$/.test(digits)) {
    throw new Error('Enter a valid Zimbabwe mobile number');
  }
  const dutch = dutchMobile(digits);
  if (dutch) {
    return dutch;
  }
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
  if (!ZIMBABWE_MOBILE.test(e164)) {
    throw new Error('Enter a valid Zimbabwe mobile number');
  }
  return e164;
}

function dutchMobile(digits: string): string | null {
  let national = digits;
  if (national.startsWith('00')) {
    national = national.slice(2);
  }
  if (/^316\d{8}$/.test(national)) {
    return `+${national}`;
  }
  if (/^06\d{8}$/.test(national)) {
    return `+316${national.slice(2)}`;
  }
  if (/^6\d{8}$/.test(national)) {
    return `+31${national}`;
  }
  return null;
}
