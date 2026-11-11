import { keepsRiderLocation, type CustomerDeliveryDetail } from './customerDeliveryDetail';
import { riderFixIsFresh } from './trackingDisplay';

export type LocationPresentation =
  | { kind: 'none' }
  | { kind: 'waiting' }
  | { kind: 'rider'; deliveryId: string; latitude: number; longitude: number };

export type MapCoordinate = {
  latitude: number;
  longitude: number;
};

export type TrackingMapView =
  | { kind: 'hidden' }
  | { kind: 'awaiting'; deliveryId: string; stop: MapCoordinate | null; headingToDropoff: boolean }
  | { kind: 'live'; deliveryId: string; rider: MapCoordinate; stop: MapCoordinate | null; headingToDropoff: boolean };

const LIVE_DELIVERY_STATUSES = new Set([
  'CREATED',
  'RIDER_ASSIGNED',
  'COLLECTING',
  'COLLECTED',
  'OUT_FOR_DELIVERY',
]);

const V1_PROGRESS_STATUSES = new Set([
  'SEARCHING',
  'ASSIGNED',
  'ARRIVED_AT_PICKUP',
  'PICKED_UP',
  'IN_TRANSIT',
  'ARRIVED_AT_DROPOFF',
]);

export function isMarketplaceDelivery(delivery: {
  serviceClass: CustomerDeliveryDetail['serviceClass'];
  status?: string;
  deliverBy?: string | null;
} | null): boolean {
  if (delivery?.serviceClass !== 'EXPRESS' && delivery?.serviceClass !== 'FLEXIBLE') {
    return false;
  }
  return !delivery.status || !V1_PROGRESS_STATUSES.has(delivery.status);
}

export function shouldPollDelivery(delivery: CustomerDeliveryDetail | null): boolean {
  return isMarketplaceDelivery(delivery) && delivery !== null && LIVE_DELIVERY_STATUSES.has(delivery.status);
}

export function showsLiveTrackingMap(delivery: CustomerDeliveryDetail | null): boolean {
  if (!delivery || !keepsRiderLocation(delivery.status)) {
    return false;
  }
  if (delivery.status === 'COLLECTED' || delivery.status === 'OUT_FOR_DELIVERY') {
    return true;
  }
  return isMarketplaceDelivery(delivery);
}

export function shouldPollBids(delivery: CustomerDeliveryDetail | null): boolean {
  return isMarketplaceDelivery(delivery) && delivery?.status === 'CREATED';
}

export function locationPresentation(activeDeliveryId: string, delivery: CustomerDeliveryDetail | null): LocationPresentation {
  if (!delivery || delivery.id !== activeDeliveryId || !keepsRiderLocation(delivery.status)) {
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

export function trackingMapView(delivery: CustomerDeliveryDetail, now: number): TrackingMapView {
  if (!keepsRiderLocation(delivery.status)) {
    return { kind: 'hidden' };
  }
  const headingToDropoff = delivery.status === 'COLLECTED' || delivery.status === 'OUT_FOR_DELIVERY';
  const stop = headingToDropoff
    ? mapCoordinate(delivery.dropoffLatitude, delivery.dropoffLongitude)
    : mapCoordinate(delivery.pickupLatitude, delivery.pickupLongitude);
  const point = delivery.riderLocation;
  if (point && riderFixIsFresh(point.updatedAt, now)) {
    return {
      kind: 'live',
      deliveryId: delivery.id,
      rider: { latitude: point.latitude, longitude: point.longitude },
      stop,
      headingToDropoff,
    };
  }
  return { kind: 'awaiting', deliveryId: delivery.id, stop, headingToDropoff };
}

function mapCoordinate(latitude: number | null, longitude: number | null): MapCoordinate | null {
  if (latitude === null || longitude === null) {
    return null;
  }
  return { latitude, longitude };
}

export function visibleBidError(status: string, error: string | null): string | null {
  if (!error || status !== 'CREATED') {
    return null;
  }
  if (/bidding is not available/i.test(error)) {
    return 'New offers are unavailable.';
  }
  return error;
}
