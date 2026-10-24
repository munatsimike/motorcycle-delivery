import { describe, expect, it } from 'vitest';

import { bookingMode } from '../../account/domain/customerAccount';
import type { CustomerDeliveryDetail } from './customerDeliveryDetail';
import {
  isMarketplaceDelivery,
  locationPresentation,
  shouldPollBids,
  shouldPollDelivery,
  showsRiderMap,
  showsStaticRoutePreview,
  staticRouteIsRiderLocation,
  usesV1Search,
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
    ...patch,
  };
}

const point = { latitude: -17.801, longitude: 31.109 };

describe('marketplace tracking', () => {
  it('shows a rider point only while the active delivery is collecting', () => {
    expect(locationPresentation('delivery-1', delivery('RIDER_ASSIGNED'))).toEqual({ kind: 'none' });
    expect(showsRiderMap(locationPresentation('delivery-1', delivery('RIDER_ASSIGNED')))).toBe(false);

    const waiting = locationPresentation('delivery-1', delivery('COLLECTING'));
    expect(waiting).toEqual({ kind: 'waiting' });
    expect(showsRiderMap(waiting)).toBe(false);

    const visible = locationPresentation('delivery-1', delivery('COLLECTING', 'delivery-1', { riderLocation: point }));
    expect(visible).toEqual({ kind: 'rider', deliveryId: 'delivery-1', ...point });
    expect(showsRiderMap(visible)).toBe(true);

    for (const status of ['COLLECTED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'] as const) {
      const hidden = locationPresentation('delivery-1', delivery(status, 'delivery-1', { riderLocation: point }));
      expect(hidden).toEqual({ kind: 'none' });
      expect(showsRiderMap(hidden)).toBe(false);
    }
  });

  it('does not reuse a sibling delivery location', () => {
    const collecting = delivery('COLLECTING', 'delivery-1', { riderLocation: point });
    const sibling = delivery('COLLECTING', 'delivery-2');
    expect(locationPresentation('delivery-2', collecting)).toEqual({ kind: 'none' });
    expect(locationPresentation('delivery-2', sibling)).toEqual({ kind: 'waiting' });
    expect(staticRouteIsRiderLocation()).toBe(false);
  });

  it('keeps the static route on V1 search and polls only the live marketplace delivery', () => {
    const searching = delivery('SEARCHING', 'delivery-1', { serviceClass: null, offeredPrice: '4.50' });
    expect(showsStaticRoutePreview(searching)).toBe(true);
    expect(showsStaticRoutePreview(delivery('COLLECTING', 'delivery-1', { riderLocation: point }))).toBe(false);
    expect(usesV1Search(searching)).toBe(true);
    expect(usesV1Search(delivery('CREATED'))).toBe(false);
    expect(shouldPollDelivery(delivery('COLLECTING'))).toBe(true);
    expect(shouldPollDelivery(delivery('DELIVERED'))).toBe(false);
    expect(shouldPollDelivery(searching)).toBe(false);
    expect(shouldPollBids(delivery('CREATED'))).toBe(true);
    expect(shouldPollBids(delivery('RIDER_ASSIGNED'))).toBe(false);
  });

  it('keeps an existing Flexible delivery on marketplace tracking when new booking is off', () => {
    const assigned = delivery('RIDER_ASSIGNED');
    expect(bookingMode(false)).toBe('v1');
    expect(isMarketplaceDelivery(assigned)).toBe(true);
    expect(usesV1Search(assigned)).toBe(false);
    expect(shouldPollDelivery(assigned)).toBe(true);
    expect(visibleBidError('RIDER_ASSIGNED', 'Bidding is not available')).toBeNull();
    expect(visibleBidError('CREATED', 'Bidding is not available')).toBe('New bids are unavailable.');
    expect(visibleBidError('CREATED', 'Bids are unavailable.')).toBe('Bids are unavailable.');
    expect(visibleBidError('COLLECTING', 'Network request failed')).toBeNull();
  });
});
