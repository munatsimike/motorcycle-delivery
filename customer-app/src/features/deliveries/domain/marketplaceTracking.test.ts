import { describe, expect, it } from 'vitest';

import { bookingMode } from '../../account/domain/customerAccount';
import type { CustomerDeliveryDetail } from './customerDeliveryDetail';
import {
  isMarketplaceDelivery,
  locationPresentation,
  shouldPollBids,
  shouldPollDelivery,
  showsRiderMap,
  trackingMapView,
  visibleBidError,
} from './marketplaceTracking';

function delivery(status: CustomerDeliveryDetail['status'], id = 'delivery-1', patch: Partial<CustomerDeliveryDetail> = {}): CustomerDeliveryDetail {
  return {
    id,
    status,
    currency: 'USD',
    offeredPrice: status === 'CREATED' ? null : '9.00',
    suggestedPrice: '8.00',
    serviceClass: 'FLEXIBLE',
    deliverBy: '2026-10-24T16:30:00.000Z',
    distanceMeters: 100,
    pickupAddress: 'Pickup',
    pickupLatitude: -17.82,
    pickupLongitude: 31.05,
    dropoffAddress: 'Drop-off',
    dropoffLatitude: -17.83,
    dropoffLongitude: 31.06,
    parcelDescription: 'Box',
    createdAt: null,
    riderLocation: null,
    pickupApproach: null,
    rider: null,
    ...patch,
  };
}

const point = { latitude: -17.801, longitude: 31.109 };
const riderPoint = { ...point, updatedAt: null };
const NOW = Date.parse('2026-10-28T16:45:00.000Z');
const freshFix = { ...point, updatedAt: new Date(NOW - 5_000).toISOString() };
const staleFix = { ...point, updatedAt: new Date(NOW - 61_000).toISOString() };

describe('marketplace tracking', () => {
  it('shows a rider point while the rider is assigned or collecting', () => {
    const waitingAssigned = locationPresentation('delivery-1', delivery('RIDER_ASSIGNED'));
    expect(waitingAssigned).toEqual({ kind: 'waiting' });
    expect(showsRiderMap(waitingAssigned)).toBe(false);

    const assigned = locationPresentation('delivery-1', delivery('RIDER_ASSIGNED', 'delivery-1', { riderLocation: riderPoint }));
    expect(assigned).toEqual({ kind: 'rider', deliveryId: 'delivery-1', ...point });
    expect(showsRiderMap(assigned)).toBe(true);

    const waiting = locationPresentation('delivery-1', delivery('COLLECTING'));
    expect(waiting).toEqual({ kind: 'waiting' });
    expect(showsRiderMap(waiting)).toBe(false);

    const visible = locationPresentation('delivery-1', delivery('COLLECTING', 'delivery-1', { riderLocation: riderPoint }));
    expect(visible).toEqual({ kind: 'rider', deliveryId: 'delivery-1', ...point });
    expect(showsRiderMap(visible)).toBe(true);

    for (const status of ['COLLECTED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'] as const) {
      const hidden = locationPresentation('delivery-1', delivery(status, 'delivery-1', { riderLocation: riderPoint }));
      expect(hidden).toEqual({ kind: 'none' });
      expect(showsRiderMap(hidden)).toBe(false);
    }
  });

  it('keeps a pickup map when GPS is missing or stale, then restores the live map', () => {
    const pickup = { latitude: -17.82, longitude: 31.05 };
    const missing = trackingMapView(delivery('RIDER_ASSIGNED'), NOW);
    expect(missing).toEqual({ kind: 'awaiting', deliveryId: 'delivery-1', pickup });

    const stale = trackingMapView(delivery('COLLECTING', 'delivery-1', { riderLocation: staleFix }), NOW);
    expect(stale).toEqual({ kind: 'awaiting', deliveryId: 'delivery-1', pickup });

    const undated = trackingMapView(delivery('COLLECTING', 'delivery-1', { riderLocation: { ...point, updatedAt: null } }), NOW);
    expect(undated).toEqual({ kind: 'awaiting', deliveryId: 'delivery-1', pickup });

    const recovered = trackingMapView(delivery('COLLECTING', 'delivery-1', { riderLocation: freshFix }), NOW);
    expect(recovered).toEqual({ kind: 'live', deliveryId: 'delivery-1', rider: point, pickup });
  });

  it('hides the rider map after pickup even when a fresh GPS point is still present', () => {
    for (const status of ['COLLECTED', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const) {
      expect(trackingMapView(delivery(status, 'delivery-1', { riderLocation: freshFix }), NOW)).toEqual({ kind: 'hidden' });
    }
  });

  it('does not reuse a sibling delivery location', () => {
    const collecting = delivery('COLLECTING', 'delivery-1', { riderLocation: riderPoint });
    const sibling = delivery('COLLECTING', 'delivery-2');
    expect(locationPresentation('delivery-2', collecting)).toEqual({ kind: 'none' });
    expect(locationPresentation('delivery-2', sibling)).toEqual({ kind: 'waiting' });
  });

  it('polls only the live marketplace delivery', () => {
    const searching = delivery('SEARCHING', 'delivery-1', { serviceClass: null, offeredPrice: '4.50' });
    expect(shouldPollDelivery(delivery('COLLECTING'))).toBe(true);
    expect(shouldPollDelivery(delivery('DELIVERED'))).toBe(false);
    expect(shouldPollDelivery(searching)).toBe(false);
    expect(shouldPollBids(delivery('CREATED'))).toBe(true);
    expect(shouldPollBids(delivery('CREATED', 'delivery-1', { deliverBy: null }))).toBe(true);
    expect(isMarketplaceDelivery(delivery('CREATED', 'delivery-1', { deliverBy: null }))).toBe(true);
    expect(shouldPollBids(delivery('RIDER_ASSIGNED'))).toBe(false);
  });

  it('keeps an existing Flexible delivery on marketplace tracking when new booking is off', () => {
    const assigned = delivery('RIDER_ASSIGNED');
    expect(bookingMode(false)).toBe('unavailable');
    expect(isMarketplaceDelivery(assigned)).toBe(true);
    expect(isMarketplaceDelivery(delivery('ASSIGNED'))).toBe(false);
    expect(shouldPollDelivery(assigned)).toBe(true);
    expect(visibleBidError('RIDER_ASSIGNED', 'Bidding is not available')).toBeNull();
    expect(visibleBidError('CREATED', 'Bidding is not available')).toBe('New bids are unavailable.');
    expect(visibleBidError('CREATED', 'Bids are unavailable.')).toBe('Bids are unavailable.');
    expect(visibleBidError('COLLECTING', 'Network request failed')).toBeNull();
  });
});
