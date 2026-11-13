import { ApiError, apiRequest } from '../api/client';
import { customerDeliveryListPath, readCustomerDeliveryPage, type CustomerDelivery, type DeliveryStatus } from './rules';
import { readBidAcceptance, readCustomerBids, readCustomerDeliveryDetail, readRouteLine, type BidAcceptance, type CustomerBid, type CustomerDeliveryDetail, type RoutePoint } from './tracking';

export function listDeliveries(accessToken: string, page: number, statuses: readonly DeliveryStatus[]) {
  return apiRequest<unknown>(customerDeliveryListPath(page, statuses), { accessToken }).then(readCustomerDeliveryPage);
}

export function loadDelivery(accessToken: string, deliveryId: string): Promise<CustomerDeliveryDetail> {
  return apiRequest<unknown>(`/customers/me/deliveries/${encodeURIComponent(deliveryId)}`, { accessToken }).then(readCustomerDeliveryDetail);
}

export function loadOffers(accessToken: string, deliveryId: string): Promise<CustomerBid[]> {
  return apiRequest<unknown>(`/customers/me/deliveries/${encodeURIComponent(deliveryId)}/bids`, { accessToken }).then(readCustomerBids);
}

export function adjustOffer(accessToken: string, deliveryId: string, offeredPrice: string): Promise<void> {
  return apiRequest<unknown>(`/customers/me/deliveries/${encodeURIComponent(deliveryId)}/offer`, {
    method: 'POST',
    body: { offeredPrice },
    accessToken,
  }).then(() => undefined);
}

export function dismissOffer(accessToken: string, deliveryId: string, bidId: string): Promise<void> {
  return apiRequest<unknown>(`/customers/me/deliveries/${encodeURIComponent(deliveryId)}/bids/${encodeURIComponent(bidId)}/dismissal`, {
    method: 'POST',
    body: {},
    accessToken,
  }).then(() => undefined);
}

export function loadDeliveryRoute(accessToken: string, deliveryId: string): Promise<RoutePoint[]> {
  return apiRequest<unknown>(`/customers/me/deliveries/${encodeURIComponent(deliveryId)}/route`, { accessToken }).then(readRouteLine);
}

export function acceptOffer(accessToken: string, deliveryId: string, bidId: string, idempotencyKey: string): Promise<BidAcceptance> {
  return apiRequest<unknown>(`/customers/me/deliveries/${encodeURIComponent(deliveryId)}/bids/${encodeURIComponent(bidId)}/acceptance`, {
    method: 'POST',
    body: {},
    accessToken,
    headers: { 'Idempotency-Key': idempotencyKey },
  }).then(readBidAcceptance);
}

export function cancelDelivery(accessToken: string, deliveryId: string): Promise<void> {
  return apiRequest<unknown>(`/customers/me/deliveries/${encodeURIComponent(deliveryId)}/cancellation`, {
    method: 'POST',
    body: {},
    accessToken,
  }).then(() => undefined);
}

export function rateDelivery(accessToken: string, deliveryId: string, stars: number): Promise<void> {
  return apiRequest<unknown>(`/customers/me/deliveries/${encodeURIComponent(deliveryId)}/rating`, {
    method: 'POST',
    body: { stars },
    accessToken,
  }).then(() => undefined);
}

export function searchForRider(accessToken: string, deliveryId: string): Promise<void> {
  return apiRequest<unknown>(`/customers/me/deliveries/${encodeURIComponent(deliveryId)}/search`, {
    method: 'POST',
    body: {},
    accessToken,
  }).then(() => undefined);
}

export function deliveryFailure(error: unknown): 'authentication' | 'unavailable' {
  return error instanceof ApiError && (error.status === 401 || error.status === 403) ? 'authentication' : 'unavailable';
}

export function deliveryErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return fallback;
}

export type { CustomerDelivery };
