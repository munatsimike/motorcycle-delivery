import { apiRequest } from '../api/client';
import { quoteBody, v2CreateBody, type PreparedBooking } from './draft';
import { readPlaceSuggestions, readResolvedPlace, type PlaceSuggestion, type ResolvedPlace } from './places';
import { readDeliveryQuote, readOpenBidRequest, type DeliveryQuote, type OpenBidRequest } from './quote';

const SEARCH_CACHE_MS = 30_000;
const searchCache = new Map<string, { at: number; suggestions: PlaceSuggestion[] }>();

export function searchPlaces(
  accessToken: string,
  text: string,
  bias: { latitude: number; longitude: number } | null,
  sessionToken: string,
): Promise<PlaceSuggestion[]> {
  const params = new URLSearchParams({ text, sessionToken });
  if (bias && Number.isFinite(bias.latitude) && Number.isFinite(bias.longitude)) {
    params.set('latitude', String(bias.latitude));
    params.set('longitude', String(bias.longitude));
  }
  const key = `${sessionToken}|${text.trim().toLowerCase()}|${bias ? `${bias.latitude.toFixed(3)},${bias.longitude.toFixed(3)}` : ''}`;
  const saved = searchCache.get(key);
  if (saved && Date.now() - saved.at < SEARCH_CACHE_MS) return Promise.resolve(saved.suggestions);
  return apiRequest<unknown>(`/customers/me/places?${params.toString()}`, { accessToken }).then((body) => {
    const suggestions = readPlaceSuggestions(body);
    searchCache.set(key, { at: Date.now(), suggestions });
    if (searchCache.size > 20) {
      const oldest = searchCache.keys().next().value;
      if (oldest) searchCache.delete(oldest);
    }
    return suggestions;
  });
}

export function resolvePlace(accessToken: string, placeId: string, sessionToken: string): Promise<ResolvedPlace> {
  const params = new URLSearchParams({ placeId, sessionToken });
  return apiRequest<unknown>(`/customers/me/places/detail?${params.toString()}`, { accessToken }).then(readResolvedPlace);
}

export function quoteDelivery(accessToken: string, booking: PreparedBooking): Promise<DeliveryQuote> {
  return apiRequest<unknown>('/customers/me/deliveries/quote', {
    method: 'POST',
    body: quoteBody(booking),
    accessToken,
  }).then(readDeliveryQuote);
}

export function createDelivery(accessToken: string, booking: PreparedBooking, offeredPrice: string, idempotencyKey: string): Promise<OpenBidRequest> {
  return apiRequest<unknown>('/customers/me/deliveries', {
    method: 'POST',
    body: v2CreateBody(booking, offeredPrice),
    accessToken,
    headers: { 'Idempotency-Key': idempotencyKey },
  }).then(readOpenBidRequest);
}
