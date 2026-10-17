const ZIMBABWE_MOBILE = /^\+2637\d{8}$/;

export function normalizeRiderPhone(input: string): string {
  const compact = input.trim().replace(/[\s().-]/g, '');
  if (!compact) {
    throw new Error('Enter a valid Zimbabwe mobile number');
  }
  const digits = compact.startsWith('+') ? compact.slice(1) : compact;
  if (!/^\d+$/.test(digits)) {
    throw new Error('Enter a valid Zimbabwe mobile number');
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
