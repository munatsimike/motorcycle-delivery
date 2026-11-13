import { customerOfferForBooking } from '../deliveries/tracking.ts';
import type { ServiceClass } from './draft.ts';

const MONEY = /^(\d{1,10})\.(\d{2})$/;

export type DeliveryQuote = {
  distanceMeters: number;
  pricingVersion: number;
  currency: 'USD';
  suggestedPrice: string;
  serviceClass: ServiceClass | null;
};

export function readDeliveryQuote(value: unknown): DeliveryQuote {
  if (!isRecord(value) || value.currency !== 'USD') throw new Error('The quote could not be read.');
  if (typeof value.suggestedPrice !== 'string' || !MONEY.test(value.suggestedPrice)) throw new Error('The quote could not be read.');
  if (!isWholeNumber(value.distanceMeters) || !isWholeNumber(value.pricingVersion)) throw new Error('The quote could not be read.');
  const serviceClass = value.serviceClass === undefined || value.serviceClass === null || value.serviceClass === ''
    ? null
    : value.serviceClass === 'EXPRESS' || value.serviceClass === 'FLEXIBLE'
      ? value.serviceClass
      : undefined;
  if (serviceClass === undefined) throw new Error('The quote could not be read.');
  return {
    distanceMeters: value.distanceMeters,
    pricingVersion: value.pricingVersion,
    currency: 'USD',
    suggestedPrice: value.suggestedPrice,
    serviceClass,
  };
}

export function quotesMatch(shown: DeliveryQuote, fresh: DeliveryQuote): boolean {
  return shown.currency === fresh.currency
    && shown.suggestedPrice === fresh.suggestedPrice
    && shown.pricingVersion === fresh.pricingVersion
    && shown.distanceMeters === fresh.distanceMeters
    && (shown.serviceClass ?? null) === (fresh.serviceClass ?? null);
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

export function quoteResultForRequest<T>(started: number, current: number, quote: T): T | null {
  return started === current ? quote : null;
}

export function confirmQuoteDecision(input: {
  shown: DeliveryQuote | null;
  fresh: DeliveryQuote;
  shownIdentity: string | null;
  identity: string;
  offerText: string;
}): { action: 'create'; offeredPrice: string } | { action: 'review'; message: string } | { action: 'invalid'; message: string } {
  if (!input.shown || input.shownIdentity !== input.identity || !quotesMatch(input.shown, input.fresh)) {
    return { action: 'review', message: 'The price changed. Review the new price and confirm again.' };
  }
  const submitted = customerOfferForBooking(input.offerText);
  if (!('offeredPrice' in submitted)) return { action: 'invalid', message: submitted.error };
  return { action: 'create', offeredPrice: submitted.offeredPrice };
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${meters} m`;
  const kilometres = meters / 1000;
  const text = kilometres >= 10 ? String(Math.round(kilometres)) : kilometres.toFixed(1);
  return `${text} km`;
}

export function moneyLabel(amount: string): string {
  return `$${amount}`;
}

export type OpenBidRequest = {
  id: string;
  status: 'CREATED';
  serviceClass: ServiceClass;
  deliverBy: string | null;
  suggestedPrice: string;
  currency: 'USD';
};

export function readOpenBidRequest(value: unknown): OpenBidRequest {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) throw new Error('Delivery details are unavailable.');
  if (value.status !== 'CREATED' || (value.serviceClass !== 'EXPRESS' && value.serviceClass !== 'FLEXIBLE')) {
    throw new Error('Delivery details are unavailable.');
  }
  const deliverBy = value.deliverBy == null || value.deliverBy === '' ? null : value.deliverBy;
  if (deliverBy !== null && (typeof deliverBy !== 'string' || Number.isNaN(new Date(deliverBy).getTime()))) {
    throw new Error('Delivery details are unavailable.');
  }
  if (value.currency !== 'USD' || typeof value.suggestedPrice !== 'string' || !MONEY.test(value.suggestedPrice)) {
    throw new Error('Delivery details are unavailable.');
  }
  return {
    id: value.id,
    status: 'CREATED',
    serviceClass: value.serviceClass,
    deliverBy,
    suggestedPrice: value.suggestedPrice,
    currency: 'USD',
  };
}

export function bookingSuccessPath(deliveryId: string): string {
  return `/deliveries/${encodeURIComponent(deliveryId)}`;
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
