import { apiGet, apiPost } from '../../../services/api/apiClient';
import { createBody, quoteBody, v2CreateBody, type PreparedBooking } from '../domain/bookingDraft';
import { readBidAcceptance, readCustomerBids, type BidAcceptance, type CustomerBid } from '../domain/customerBids';
import { readOpenBidRequest, type OpenBidRequest } from '../domain/openBidRequest';
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

  async createOpenRequest(accessToken: string, booking: PreparedBooking, offeredPrice: string): Promise<OpenBidRequest> {
    const body = await apiPost<unknown>('/customers/me/deliveries', v2CreateBody(booking, offeredPrice), { accessToken });
    return readOpenBidRequest(body);
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

  searchOpenPlaces(text: string, sessionToken: string): Promise<PlaceSuggestion[]> {
    return this.loadPlaces(`/auth/places?${placeQuery(text, null, sessionToken)}`, undefined, text, null, sessionToken);
  }

  resolvePlace(accessToken: string, placeId: string, sessionToken: string): Promise<ResolvedPlace> {
    return this.loadPlace(`/customers/me/places/detail?${detailQuery(placeId, sessionToken)}`, accessToken);
  }

  resolveRegistrationPlace(registrationToken: string, placeId: string, sessionToken: string): Promise<ResolvedPlace> {
    return this.loadPlace(`/auth/customer/places/detail?${detailQuery(placeId, sessionToken)}`, registrationToken);
  }

  resolveOpenPlace(placeId: string, sessionToken: string): Promise<ResolvedPlace> {
    return this.loadPlace(`/auth/places/detail?${detailQuery(placeId, sessionToken)}`);
  }

  private async loadPlace(path: string, token?: string): Promise<ResolvedPlace> {
    const body = await apiGet<unknown>(path, token ? { accessToken: token } : undefined);
    return readResolvedPlace(body);
  }

  private async loadPlaces(
    path: string,
    token: string | undefined,
    text: string,
    bias: PlaceBias | null | undefined,
    sessionToken: string,
  ): Promise<PlaceSuggestion[]> {
    const key = placeCacheKey(text, bias, sessionToken);
    const saved = searchCache.get(key);
    if (saved && Date.now() - saved.at < SEARCH_CACHE_MS) {
      return saved.suggestions;
    }
    const body = await apiGet<unknown>(path, token ? { accessToken: token } : undefined);
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

  async listBids(accessToken: string, deliveryId: string): Promise<CustomerBid[]> {
    const body = await apiGet<unknown>(
      `/customers/me/deliveries/${encodeURIComponent(deliveryId)}/bids`,
      { accessToken },
    );
    return readCustomerBids(body);
  }

  async acceptBid(accessToken: string, deliveryId: string, bidId: string, idempotencyKey: string): Promise<BidAcceptance> {
    const body = await apiPost<unknown>(
      `/customers/me/deliveries/${encodeURIComponent(deliveryId)}/bids/${encodeURIComponent(bidId)}/acceptance`,
      {},
      { accessToken, headers: { 'Idempotency-Key': idempotencyKey } },
    );
    return readBidAcceptance(body);
  }

  async search(accessToken: string, deliveryId: string): Promise<void> {
    await apiPost<unknown>(
      `/customers/me/deliveries/${encodeURIComponent(deliveryId)}/search`,
      {},
      { accessToken },
    );
  }

  async adjustOffer(accessToken: string, deliveryId: string, offeredPrice: string): Promise<{ customerOffer: string }> {
    const body = await apiPost<unknown>(
      `/customers/me/deliveries/${encodeURIComponent(deliveryId)}/offer`,
      { offeredPrice },
      { accessToken },
    );
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('This offer could not be saved.');
    }
    const customerOffer = (body as { customerOffer?: unknown }).customerOffer;
    if (typeof customerOffer !== 'string' || !customerOffer.trim()) {
      throw new Error('This offer could not be saved.');
    }
    return { customerOffer };
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

const SEARCH_CACHE_MS = 30_000;
const searchCache = new Map<string, { at: number; suggestions: PlaceSuggestion[] }>();
