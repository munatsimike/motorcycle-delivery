import type { CustomerDeliveryDetail } from './customerDeliveryDetail';
import { deliveryHasMapCoordinates } from './customerDeliveryDetail';

export type LocationPresentation =
  | { kind: 'none' }
  | { kind: 'waiting' }
  | { kind: 'rider'; deliveryId: string; latitude: number; longitude: number };

const LIVE_DELIVERY_STATUSES = new Set([
  'CREATED',
  'RIDER_ASSIGNED',
  'COLLECTING',
  'COLLECTED',
  'OUT_FOR_DELIVERY',
]);

export function isMarketplaceDelivery(delivery: { serviceClass: CustomerDeliveryDetail['serviceClass'] } | null): boolean {
  return delivery?.serviceClass === 'EXPRESS' || delivery?.serviceClass === 'FLEXIBLE';
}

export function shouldPollDelivery(delivery: CustomerDeliveryDetail | null): boolean {
  return isMarketplaceDelivery(delivery) && delivery !== null && LIVE_DELIVERY_STATUSES.has(delivery.status);
}

export function shouldPollBids(delivery: CustomerDeliveryDetail | null): boolean {
  return isMarketplaceDelivery(delivery) && delivery?.status === 'CREATED';
}

export function locationPresentation(activeDeliveryId: string, delivery: CustomerDeliveryDetail | null): LocationPresentation {
  if (!delivery || delivery.id !== activeDeliveryId || delivery.status !== 'COLLECTING') {
    return { kind: 'none' };
  }
  if (!delivery.riderLocation) {
    return { kind: 'waiting' };
  }
  return {
    kind: 'rider',
    deliveryId: delivery.id,
    latitude: delivery.riderLocation.latitude,
    longitude: delivery.riderLocation.longitude,
  };
}

export function showsRiderMap(presentation: LocationPresentation): boolean {
  return presentation.kind === 'rider';
}

export function showsStaticRoutePreview(delivery: CustomerDeliveryDetail | null): boolean {
  return Boolean(
    delivery
    && delivery.serviceClass == null
    && delivery.status === 'SEARCHING'
    && deliveryHasMapCoordinates(delivery),
  );
}

export function staticRouteIsRiderLocation(): boolean {
  return false;
}

export function usesV1Search(delivery: CustomerDeliveryDetail | null): boolean {
  return !isMarketplaceDelivery(delivery);
}

export function visibleBidError(status: string, error: string | null): string | null {
  if (!error || status !== 'CREATED') {
    return null;
  }
  if (/bidding is not available/i.test(error)) {
    return 'New bids are unavailable.';
  }
  return error;
}
