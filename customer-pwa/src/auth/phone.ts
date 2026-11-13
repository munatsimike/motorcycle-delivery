export function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/[\s()-]/g, '');

  if (/^07\d{8}$/.test(cleaned)) {
    return `+263${cleaned.slice(1)}`;
  }

  if (/^7\d{8}$/.test(cleaned)) {
    return `+263${cleaned}`;
  }

  if (/^06\d{8}$/.test(cleaned)) {
    return `+31${cleaned.slice(1)}`;
  }

  if (/^6\d{8}$/.test(cleaned)) {
    return `+31${cleaned}`;
  }

  if (/^\+(2637\d{8}|316\d{8})$/.test(cleaned)) {
    return cleaned;
  }

  if (/^2637\d{8}$/.test(cleaned) || /^316\d{8}$/.test(cleaned)) {
    return `+${cleaned}`;
  }

  throw new Error('Enter a valid Zimbabwe mobile number.');
}
