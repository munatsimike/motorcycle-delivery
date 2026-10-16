const MONEY = /^(\d{1,10})\.(\d{2})$/;

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

export function canOfferQuotedPrice(suggestedPrice: string): boolean {
  return MONEY.test(suggestedPrice) && suggestedPrice !== '0.00';
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
