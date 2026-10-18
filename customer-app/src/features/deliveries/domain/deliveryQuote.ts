const MONEY = /^(\d{1,10})\.(\d{2})$/;

// Keep this aligned with MAXIMUM_CUSTOMER_OFFER_CENTS in the backend delivery request.
export const MAXIMUM_CUSTOMER_OFFER_CENTS = 100_000;

export function offerFieldText(value: string): string {
  const cleaned = decimalSeparatorText(value).replace(/[^\d.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot === -1) {
    return cleaned.slice(0, 4);
  }
  const whole = cleaned.slice(0, dot).slice(0, 4);
  const fraction = cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2);
  return `${whole}.${fraction}`;
}

export function normalizeCustomerOffer(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(trimmed) || trimmed.endsWith('.')) {
    return null;
  }
  const [whole, fraction = ''] = trimmed.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAXIMUM_CUSTOMER_OFFER_CENTS) {
    return null;
  }
  const normalizedWhole = Math.trunc(cents / 100);
  const normalizedFraction = String(cents % 100).padStart(2, '0');
  return `${normalizedWhole}.${normalizedFraction}`;
}

export function customerOfferForBooking(value: string): { offeredPrice: string } | { error: string } {
  const offeredPrice = normalizeCustomerOffer(value);
  if (!offeredPrice) {
    return { error: 'Enter an offer from $0.01 to $1,000.00.' };
  }
  return { offeredPrice };
}

export function nextCustomerOffer(input: {
  current: string;
  edited: boolean;
  previousPinKey: string | null;
  pinKey: string;
  suggestedPrice: string;
}): { text: string; edited: boolean; pinKey: string } {
  if (input.previousPinKey !== input.pinKey || !input.edited) {
    return { text: input.suggestedPrice, edited: false, pinKey: input.pinKey };
  }
  return { text: input.current, edited: true, pinKey: input.pinKey };
}

export type DeliveryQuote = {
  distanceMeters: number;
  pricingVersion: number;
  currency: 'USD';
  suggestedPrice: string;
};

export function readDeliveryQuote(value: unknown): DeliveryQuote {
  if (!isRecord(value)) {
    throw new Error('The quote could not be read.');
  }
  if (value.currency !== 'USD') {
    throw new Error('The quote could not be read.');
  }
  if (typeof value.suggestedPrice !== 'string' || !MONEY.test(value.suggestedPrice)) {
    throw new Error('The quote could not be read.');
  }
  if (!isWholeNumber(value.distanceMeters) || !isWholeNumber(value.pricingVersion)) {
    throw new Error('The quote could not be read.');
  }
  return {
    distanceMeters: value.distanceMeters,
    pricingVersion: value.pricingVersion,
    currency: 'USD',
    suggestedPrice: value.suggestedPrice,
  };
}

export function quotesMatch(shown: DeliveryQuote, fresh: DeliveryQuote): boolean {
  return shown.currency === fresh.currency
    && shown.suggestedPrice === fresh.suggestedPrice
    && shown.pricingVersion === fresh.pricingVersion
    && shown.distanceMeters === fresh.distanceMeters;
}

export function canOfferQuotedPrice(offeredPrice: string): boolean {
  return normalizeCustomerOffer(offeredPrice) === offeredPrice;
}

function decimalSeparatorText(value: string): string {
  const compact = value.replace(/\s/g, '');
  if (/^\d{1,3}(,\d{3})+$/.test(compact)) {
    return compact.replace(/,/g, '');
  }
  const lastComma = compact.lastIndexOf(',');
  const lastDot = compact.lastIndexOf('.');
  if (lastComma !== -1 && lastComma > lastDot) {
    return `${compact.slice(0, lastComma).replace(/[.,]/g, '')}.${compact.slice(lastComma + 1)}`;
  }
  return compact.replace(/,/g, '');
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
