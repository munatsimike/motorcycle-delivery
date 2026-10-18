import { apiGet, apiGetBytes, apiPost } from '../../../services/api/apiClient';
import { createBody, quoteBody, type PreparedBooking } from '../domain/bookingDraft';
import { readCustomerDeliveryDetail, type CustomerDeliveryDetail } from '../domain/customerDeliveryDetail';
import { readCustomerDeliveryPage, type CustomerDeliveryPage } from '../domain/customerDeliveryList';
import { readDeliveryQuote, type DeliveryQuote } from '../domain/deliveryQuote';
import { readPlaceSuggestions, readResolvedPlace, type PlaceSuggestion, type ResolvedPlace } from '../domain/placeSuggestion';
import type { CustomerDeliveryRepository } from '../domain/repositories/CustomerDeliveryRepository';

export type PlaceBias = {
  latitude: number;
  longitude: number;
};

function placeQuery(text: string, bias: PlaceBias | null | undefined, sessionToken: string): string {
  const params = new URLSearchParams();
  params.set('text', text);
  params.set('sessionToken', sessionToken);
  if (
    bias
    && Number.isFinite(bias.latitude)
    && Number.isFinite(bias.longitude)
    && bias.latitude >= -90
    && bias.latitude <= 90
    && bias.longitude >= -180
    && bias.longitude <= 180
  ) {
    params.set('latitude', String(bias.latitude));
    params.set('longitude', String(bias.longitude));
  }
  return params.toString();
}

function detailQuery(placeId: string, sessionToken: string): string {
  const params = new URLSearchParams();
  params.set('placeId', placeId);
  params.set('sessionToken', sessionToken);
  return params.toString();
}

function placeCacheKey(text: string, bias: PlaceBias | null | undefined, sessionToken: string): string {
  const point = bias && Number.isFinite(bias.latitude) && Number.isFinite(bias.longitude)
    ? `${bias.latitude.toFixed(3)},${bias.longitude.toFixed(3)}`
    : '';
  return `${sessionToken}|${text.trim().toLowerCase()}|${point}`;
}

export class CustomerDeliveryApiRepository implements CustomerDeliveryRepository {
  async quote(accessToken: string, booking: PreparedBooking): Promise<DeliveryQuote> {
    const body = await apiPost<unknown>('/customers/me/deliveries/quote', quoteBody(booking), { accessToken });
    return readDeliveryQuote(body);
  }

  async create(accessToken: string, booking: PreparedBooking, offeredPrice: string): Promise<CustomerDeliveryDetail> {
    const body = await apiPost<unknown>('/customers/me/deliveries', createBody(booking, offeredPrice), { accessToken });
    return readCustomerDeliveryDetail(body);
  }

  async getById(accessToken: string, deliveryId: string): Promise<CustomerDeliveryDetail> {
    const body = await apiGet<unknown>(`/customers/me/deliveries/${encodeURIComponent(deliveryId)}`, { accessToken });
    return readCustomerDeliveryDetail(body);
  }

  async list(accessToken: string, path: string): Promise<CustomerDeliveryPage> {
    const body = await apiGet<unknown>(path, { accessToken });
    return readCustomerDeliveryPage(body);
  }

  searchPlaces(
    accessToken: string,
    text: string,
    bias: PlaceBias | null | undefined,
    sessionToken: string,
  ): Promise<PlaceSuggestion[]> {
    return this.loadPlaces(`/customers/me/places?${placeQuery(text, bias, sessionToken)}`, accessToken, text, bias, sessionToken);
  }

  searchRegistrationPlaces(
    registrationToken: string,
    text: string,
    bias: PlaceBias | null | undefined,
    sessionToken: string,
  ): Promise<PlaceSuggestion[]> {
    return this.loadPlaces(`/auth/customer/places?${placeQuery(text, bias, sessionToken)}`, registrationToken, text, bias, sessionToken);
  }

  resolvePlace(accessToken: string, placeId: string, sessionToken: string): Promise<ResolvedPlace> {
    return this.loadPlace(`/customers/me/places/detail?${detailQuery(placeId, sessionToken)}`, accessToken);
  }

  resolveRegistrationPlace(registrationToken: string, placeId: string, sessionToken: string): Promise<ResolvedPlace> {
    return this.loadPlace(`/auth/customer/places/detail?${detailQuery(placeId, sessionToken)}`, registrationToken);
  }

  private async loadPlace(path: string, token: string): Promise<ResolvedPlace> {
    const body = await apiGet<unknown>(path, { accessToken: token });
    return readResolvedPlace(body);
  }

  private async loadPlaces(
    path: string,
    token: string,
    text: string,
    bias: PlaceBias | null | undefined,
    sessionToken: string,
  ): Promise<PlaceSuggestion[]> {
    const key = placeCacheKey(text, bias, sessionToken);
    const saved = searchCache.get(key);
    if (saved && Date.now() - saved.at < SEARCH_CACHE_MS) {
      return saved.suggestions;
    }
    const body = await apiGet<unknown>(path, { accessToken: token });
    const suggestions = readPlaceSuggestions(body);
    searchCache.set(key, { at: Date.now(), suggestions });
    if (searchCache.size > 20) {
      const oldest = searchCache.keys().next().value;
      if (oldest) {
        searchCache.delete(oldest);
      }
    }
    return suggestions;
  }

  async search(accessToken: string, deliveryId: string): Promise<void> {
    await apiPost<unknown>(
      `/customers/me/deliveries/${encodeURIComponent(deliveryId)}/search`,
      {},
      { accessToken },
    );
  }

  async cancel(accessToken: string, deliveryId: string): Promise<void> {
    await apiPost<unknown>(
      `/customers/me/deliveries/${encodeURIComponent(deliveryId)}/cancellation`,
      {},
      { accessToken },
    );
  }
}

export const customerDeliveryRepository = new CustomerDeliveryApiRepository();

const mapImages = new Map<string, string | null>();

export async function loadDeliveryMapImage(accessToken: string, deliveryId: string): Promise<string | null> {
  const saved = mapImages.get(deliveryId);
  if (saved !== undefined) {
    return saved;
  }
  const bytes = await apiGetBytes(
    `/customers/me/deliveries/${encodeURIComponent(deliveryId)}/map?labels=off`,
    { accessToken },
  );
  const image = bytes && bytes.length > 0 ? pngDataUrl(bytes) : null;
  mapImages.set(deliveryId, image);
  return image;
}

function pngDataUrl(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let encoded = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const triple = (first << 16) | (second << 8) | third;
    encoded += alphabet[(triple >> 18) & 63];
    encoded += alphabet[(triple >> 12) & 63];
    encoded += index + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : '=';
    encoded += index + 2 < bytes.length ? alphabet[triple & 63] : '=';
  }
  return `data:image/png;base64,${encoded}`;
}

const SEARCH_CACHE_MS = 30_000;
const searchCache = new Map<string, { at: number; suggestions: PlaceSuggestion[] }>();
