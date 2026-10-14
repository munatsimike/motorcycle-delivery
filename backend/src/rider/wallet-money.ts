const MONEY = /^(\d{1,10})\.(\d{2})$/;

export function signedCentsFromDecimal(
  value: string | { toFixed(digits: number): string } | null | undefined,
): number {
  if (value === null || value === undefined) {
    return 0;
  }
  const text = typeof value === 'string' ? value : value.toFixed(2);
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const match = MONEY.exec(unsigned);
  if (!match) {
    throw new Error('Stored wallet amount is invalid');
  }
  const cents = Number(match[1]) * 100 + Number(match[2]);
  if (!Number.isSafeInteger(cents)) {
    throw new Error('Stored wallet amount is invalid');
  }
  return negative ? -cents : cents;
}

export function formatSignedCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new Error('Unsafe wallet amount');
  }
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const whole = Math.trunc(absolute / 100);
  const fraction = absolute % 100;
  return `${sign}${whole}.${String(fraction).padStart(2, '0')}`;
}
