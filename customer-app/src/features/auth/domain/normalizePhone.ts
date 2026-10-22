export function looksLikeDutchPhoneEntry(phone: string): boolean {
  const cleaned = phone.replace(/[\s()-]/g, '');
  return cleaned.startsWith('+31') || cleaned.startsWith('0031') || cleaned.startsWith('316') || /^0?6\d{0,8}$/.test(cleaned);
}

export function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/[\s()-]/g, '');

  // Zimbabwe mobile numbers
  if (/^07\d{8}$/.test(cleaned)) {
    return `+263${cleaned.slice(1)}`;
  }

  if (/^7\d{8}$/.test(cleaned)) {
    return `+263${cleaned}`;
  }

  // Netherlands mobile numbers
  if (/^06\d{8}$/.test(cleaned)) {
    return `+31${cleaned.slice(1)}`;
  }

  if (/^6\d{8}$/.test(cleaned)) {
    return `+31${cleaned}`;
  }

  // Already in international format
  if (/^\+(2637\d{8}|316\d{8})$/.test(cleaned)) {
    return cleaned;
  }

  if (/^2637\d{8}$/.test(cleaned) || /^316\d{8}$/.test(cleaned)) {
    return `+${cleaned}`;
  }

  throw new Error(
    'Enter a valid Zimbabwe mobile number.',
  );
}
