import { describe, expect, it } from 'vitest';

import {
  ACTIVE_DELIVERY_STATUSES,
  DELIVERY_STATUSES,
  HISTORY_DELIVERY_STATUSES,
  deliveriesInGroup,
  deliveryGroup,
  deliveryCardStatusLabel,
  deliveryListLabel,
  showsViewBids,
  deliveryCanDelete,
  deliveryCanSearchAgain,
  usesDeliveryOutcomeScreen,
  trackingRequestActions,
  deliveryStatusLabel,
  deliveryUsesPackageIcon,
  type CustomerDelivery,
} from './deliveryStatus';

describe('deliveryGroup', () => {
  it('keeps nonterminal statuses active', () => {
    expect(deliveryGroup('CREATED')).toBe('active');
    expect(deliveryGroup('SEARCHING')).toBe('active');
    expect(deliveryGroup('NO_RIDER_FOUND')).toBe('active');
    expect(deliveryGroup('ASSIGNED')).toBe('active');
    expect(deliveryGroup('ARRIVED_AT_PICKUP')).toBe('active');
    expect(deliveryGroup('PICKED_UP')).toBe('active');
    expect(deliveryGroup('IN_TRANSIT')).toBe('active');
    expect(deliveryGroup('ARRIVED_AT_DROPOFF')).toBe('active');
    expect(deliveryGroup('RIDER_ASSIGNED')).toBe('active');
    expect(deliveryGroup('COLLECTING')).toBe('active');
    expect(deliveryGroup('COLLECTED')).toBe('active');
    expect(deliveryGroup('OUT_FOR_DELIVERY')).toBe('active');
  });

  it('keeps completed, cancelled, and failed deliveries in history', () => {
    expect(deliveryGroup('DELIVERED')).toBe('history');
    expect(deliveryGroup('CANCELLED')).toBe('history');
    expect(deliveryGroup('FAILED')).toBe('history');
  });

  it('places every backend status in exactly one group', () => {
    for (const status of DELIVERY_STATUSES) {
      const groups = [
        ACTIVE_DELIVERY_STATUSES.has(status),
        HISTORY_DELIVERY_STATUSES.has(status),
      ].filter(Boolean);
      expect(groups).toHaveLength(1);
    }
  });
});

describe('deliveriesInGroup', () => {
  const deliveries: CustomerDelivery[] = [
    { id: '1', status: 'IN_TRANSIT', createdAt: '2026-10-16T12:00:00.000Z', pickupAddress: 'A', dropoffAddress: 'B' },
    { id: '2', status: 'DELIVERED', createdAt: '2026-10-16T12:00:00.000Z', pickupAddress: 'C', dropoffAddress: 'D' },
    { id: '3', status: 'CANCELLED', createdAt: '2026-10-16T12:00:00.000Z', pickupAddress: 'E', dropoffAddress: 'F' },
  ];

  it('returns only active deliveries', () => {
    expect(deliveriesInGroup(deliveries, 'active').map((delivery) => delivery.id)).toEqual(['1']);
  });

  it('returns only history deliveries', () => {
    expect(deliveriesInGroup(deliveries, 'history').map((delivery) => delivery.id)).toEqual(['2', '3']);
  });
});

describe('deliveryStatusLabel', () => {
  it('uses the backend status names', () => {
    expect(deliveryStatusLabel('SEARCHING')).toBe('Finding a rider');
    expect(deliveryStatusLabel('ASSIGNED')).toBe('Rider assigned');
    expect(deliveryStatusLabel('NO_RIDER_FOUND')).toBe('No rider found');
    expect(deliveryStatusLabel('PICKED_UP')).toBe('Parcel picked up');
    expect(deliveryStatusLabel('DELIVERED')).toBe('Delivered');
    expect(deliveryStatusLabel('FAILED')).toBe('Failed');
    expect(deliveryStatusLabel('RIDER_ASSIGNED')).toBe('Rider assigned');
    expect(deliveryStatusLabel('COLLECTING')).toBe('Collecting');
    expect(deliveryStatusLabel('COLLECTED')).toBe('Collected');
    expect(deliveryStatusLabel('OUT_FOR_DELIVERY')).toBe('Out for delivery');
  });
});

describe('usesDeliveryOutcomeScreen', () => {
  it('opens collected, delivered, cancelled, failed, and no-rider deliveries on the detail screen', () => {
    expect(usesDeliveryOutcomeScreen('COLLECTED')).toBe(true);
    expect(usesDeliveryOutcomeScreen('PICKED_UP')).toBe(true);
    expect(usesDeliveryOutcomeScreen('OUT_FOR_DELIVERY')).toBe(true);
    expect(usesDeliveryOutcomeScreen('IN_TRANSIT')).toBe(true);
    expect(usesDeliveryOutcomeScreen('ARRIVED_AT_DROPOFF')).toBe(true);
    expect(usesDeliveryOutcomeScreen('DELIVERED')).toBe(true);
    expect(usesDeliveryOutcomeScreen('CANCELLED')).toBe(true);
    expect(usesDeliveryOutcomeScreen('FAILED')).toBe(true);
    expect(usesDeliveryOutcomeScreen('NO_RIDER_FOUND')).toBe(true);
    expect(usesDeliveryOutcomeScreen('RIDER_ASSIGNED')).toBe(false);
    expect(usesDeliveryOutcomeScreen('COLLECTING')).toBe(false);
  });
});

describe('deliveryUsesPackageIcon', () => {
  it('uses a package icon for deliveries that are not active', () => {
    expect(deliveryUsesPackageIcon('DELIVERED')).toBe(true);
    expect(deliveryUsesPackageIcon('CANCELLED')).toBe(false);
    expect(deliveryUsesPackageIcon('FAILED')).toBe(true);
    expect(deliveryUsesPackageIcon('SEARCHING')).toBe(false);
    expect(deliveryUsesPackageIcon('IN_TRANSIT')).toBe(false);
  });
});

describe('marketplace list labels', () => {
  it('waits for bids on an open V2 request and keeps V1 search on the V1 path', () => {
    expect(deliveryListLabel({ status: 'CREATED', serviceClass: 'FLEXIBLE', deliverBy: '2026-10-24T16:30:00.000Z' })).toBe('Waiting for bids');
    expect(deliveryListLabel({ status: 'CREATED', serviceClass: 'FLEXIBLE', deliverBy: null })).toBe('Waiting for bids');
    expect(deliveryListLabel({ status: 'CREATED', serviceClass: null, deliverBy: null })).toBe('Pending');
    expect(deliveryListLabel({ status: 'CREATED', serviceClass: null })).toBe('Pending');
    expect(deliveryListLabel({ status: 'SEARCHING', serviceClass: null })).toBe('Finding a rider');
    expect(deliveryCanSearchAgain({ status: 'NO_RIDER_FOUND', serviceClass: null })).toBe(false);
    expect(deliveryCanSearchAgain({ status: 'NO_RIDER_FOUND', serviceClass: 'EXPRESS', deliverBy: null })).toBe(true);
    expect(deliveryCanSearchAgain({ status: 'NO_RIDER_FOUND', serviceClass: 'FLEXIBLE', deliverBy: null })).toBe(true);
    expect(deliveryCanSearchAgain({ status: 'NO_RIDER_FOUND', serviceClass: 'EXPRESS', deliverBy: '2026-10-24T16:30:00.000Z' }, Date.parse('2026-10-27T12:00:00.000Z'))).toBe(false);
    expect(deliveryCanSearchAgain({ status: 'NO_RIDER_FOUND', serviceClass: 'FLEXIBLE', deliverBy: '2026-12-01T12:00:00.000Z' }, Date.parse('2026-10-27T12:00:00.000Z'))).toBe(true);
    expect(deliveryCanSearchAgain({ status: 'CREATED', serviceClass: 'FLEXIBLE', deliverBy: '2026-10-24T16:30:00.000Z' })).toBe(false);
  });

  it('shows a bid count only while a marketplace request has actionable bids', () => {
    const waiting = { status: 'CREATED' as const, serviceClass: 'FLEXIBLE' as const, deliverBy: '2026-10-24T16:30:00.000Z' };
    expect(deliveryCardStatusLabel({ ...waiting, openBidCount: 0 })).toBe('Waiting for bids');
    expect(showsViewBids({ ...waiting, openBidCount: 0 })).toBe(false);
    expect(deliveryCardStatusLabel({ ...waiting, openBidCount: 1 })).toBe('1 bid received');
    expect(showsViewBids({ ...waiting, openBidCount: 1 })).toBe(true);
    expect(deliveryCardStatusLabel({ ...waiting, openBidCount: 4 })).toBe('4 bids received');
    expect(showsViewBids({ ...waiting, openBidCount: 4 })).toBe(true);
    expect(deliveryCardStatusLabel({ status: 'SEARCHING', serviceClass: null, openBidCount: 3 })).toBe('Finding a rider');
    expect(showsViewBids({ status: 'SEARCHING', serviceClass: null, openBidCount: 3 })).toBe(false);
    expect(deliveryCardStatusLabel({ status: 'RIDER_ASSIGNED', serviceClass: 'EXPRESS', openBidCount: 2 })).toBe('Rider assigned');
    expect(showsViewBids({ status: 'RIDER_ASSIGNED', serviceClass: 'EXPRESS', openBidCount: 2 })).toBe(false);
  });

  it('shows delete for every no-rider request and search again for legacy or an open marketplace request', () => {
    const now = Date.parse('2026-10-27T12:00:00.000Z');
    expect(trackingRequestActions({ status: 'NO_RIDER_FOUND', serviceClass: null }, now)).toEqual({
      searchAgain: false,
      deleteRequest: true,
    });
    expect(trackingRequestActions({ status: 'NO_RIDER_FOUND', serviceClass: 'FLEXIBLE', deliverBy: null }, now)).toEqual({
      searchAgain: true,
      deleteRequest: true,
    });
    expect(trackingRequestActions({ status: 'NO_RIDER_FOUND', serviceClass: 'EXPRESS', deliverBy: '2026-10-24T16:30:00.000Z' }, now)).toEqual({
      searchAgain: false,
      deleteRequest: true,
    });
    expect(deliveryCanDelete({ status: 'NO_RIDER_FOUND' })).toBe(true);
    expect(trackingRequestActions({ status: 'ASSIGNED', serviceClass: 'FLEXIBLE' })).toEqual({
      searchAgain: false,
      deleteRequest: false,
    });
    expect(trackingRequestActions({ status: 'SEARCHING', serviceClass: null })).toEqual({
      searchAgain: false,
      deleteRequest: false,
    });
    expect(trackingRequestActions({ status: 'CREATED', serviceClass: 'FLEXIBLE', deliverBy: '2026-10-24T16:30:00.000Z' })).toEqual({
      searchAgain: false,
      deleteRequest: false,
    });
  });
});
