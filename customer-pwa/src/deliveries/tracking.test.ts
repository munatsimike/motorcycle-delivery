import assert from 'node:assert/strict';
import test from 'node:test';
import {
  customerCanCancelDelivery,
  customerOfferForBooking,
  deliveryActions,
  deliveryScreen,
  detailViewState,
  locationAgeLabel,
  acceptanceKeyFor,
  clearAcceptanceKey,
  createAcceptanceGate,
  duplicateAcceptanceNotice,
  offerFieldText,
  offersMissingSince,
  readBidAcceptance,
  readCustomerDeliveryDetail,
  receivedOfferCountLabel,
  readRouteLine,
  riderFixIsFresh,
  riderPhotoPresentation,
  shouldPollDelivery,
  shouldShowRiderConfirmed,
  showsCompletedRoute,
  sortRiderOffers,
  showsTrackingRoute,
  trackingCameraRegion,
  trackingCameraShouldMove,
  trackingMapView,
  type CustomerBid,
  type CustomerDeliveryDetail,
} from './tracking.ts';

const NOW = Date.parse('2026-11-13T12:00:00.000Z');

function detail(overrides: Partial<CustomerDeliveryDetail> = {}): CustomerDeliveryDetail {
  return {
    id: 'delivery-1',
    status: 'RIDER_ASSIGNED',
    currency: 'USD',
    offeredPrice: '4.50',
    suggestedPrice: '3.00',
    customerOffer: null,
    serviceClass: 'EXPRESS',
    deliverBy: null,
    distanceMeters: 2400,
    pickupAddress: 'Pickup road',
    senderName: null,
    pickupLatitude: -17.82,
    pickupLongitude: 31.05,
    dropoffAddress: 'Dropoff road',
    recipientName: null,
    dropoffLatitude: -17.83,
    dropoffLongitude: 31.06,
    parcelDescription: 'Parcel',
    createdAt: '2026-11-13T11:00:00.000Z',
    completedAt: null,
    riderLocation: { latitude: -17.821, longitude: 31.051, updatedAt: new Date(NOW - 10_000).toISOString() },
    pickupApproach: { metres: 800, seconds: 180, line: [] },
    rider: { name: 'Ada Rider', verified: true, motorcycle: 'Honda', registrationNumber: 'ABC', colour: 'Yellow', phone: '+263771234567', hasProfilePhoto: false },
    rating: { eligible: false, submitted: false, stars: null },
    ...overrides,
  };
}

test('delivery details reject an incomplete payload', () => {
  const parsed = readCustomerDeliveryDetail({
    id: 'delivery-1',
    status: 'COLLECTED',
    currency: 'USD',
    offeredPrice: '4.50',
    suggestedPrice: '3.00',
    serviceClass: 'FLEXIBLE',
    deliverBy: null,
    distanceMeters: 10,
    pickup: { address: 'Pickup', latitude: -17.8, longitude: 31 },
    dropoff: { address: 'Dropoff', latitude: -17.9, longitude: 31.1 },
    parcel: { description: 'Food' },
    riderLocation: { latitude: -17.81, longitude: 31.01, updatedAt: new Date(NOW).toISOString() },
    pickupApproach: { metres: 20, seconds: 40, line: [{ latitude: -17.8, longitude: 31 }] },
    rider: { name: 'Ada Rider', verified: true, hasProfilePhoto: false },
    rating: { eligible: false, submitted: false },
  });
  assert.equal(parsed.status, 'COLLECTED');
  assert.equal(parsed.pickupApproach?.metres, 20);
  assert.throws(() => readCustomerDeliveryDetail({ id: 'x' }), /unavailable/);
});

test('status chooses offers, live tracking, or the outcome screen', () => {
  assert.equal(deliveryScreen(detail({ status: 'CREATED', riderLocation: null, pickupApproach: null })), 'offers');
  assert.equal(deliveryScreen(detail()), 'tracking');
  assert.equal(deliveryScreen(detail({ status: 'COLLECTED' })), 'tracking');
  assert.equal(deliveryScreen(detail({ status: 'DELIVERED', serviceClass: null, riderLocation: null, pickupApproach: null })), 'outcome');
  assert.equal(detailViewState({ isLoading: true, error: null, hasDelivery: false }), 'loading');
  assert.equal(detailViewState({ isLoading: false, error: 'Delivery details are unavailable.', hasDelivery: false }), 'error');
  assert.equal(detailViewState({ isLoading: false, error: 'Saved', hasDelivery: true }), 'ready');
});

test('tracking stays hidden when the rider GPS is stale and follows the destination after collection', () => {
  const fresh = trackingMapView(detail(), NOW);
  assert.equal(fresh.kind, 'live');
  if (fresh.kind === 'live') assert.equal(fresh.headingToDropoff, false);
  assert.equal(fresh.kind === 'live' ? fresh.stop?.latitude : null, -17.82);
  const collected = trackingMapView(detail({ status: 'COLLECTED' }), NOW);
  assert.equal(collected.kind, 'live');
  if (collected.kind === 'live') {
    assert.equal(collected.headingToDropoff, true);
    assert.equal(collected.stop?.latitude, -17.83);
  }
  const stale = trackingMapView(detail({
    riderLocation: { latitude: -17.821, longitude: 31.051, updatedAt: new Date(NOW - 61_000).toISOString() },
  }), NOW);
  assert.equal(stale.kind, 'awaiting');
  assert.equal(riderFixIsFresh(new Date(NOW - 10_000).toISOString(), NOW), true);
  assert.equal(riderFixIsFresh(null, NOW), false);
  assert.equal(locationAgeLabel(new Date(NOW - 5_000).toISOString(), NOW), 'Updated 5 seconds ago');
  assert.equal(shouldPollDelivery(detail()), true);
  assert.equal(shouldPollDelivery(detail({ status: 'DELIVERED', serviceClass: null })), false);
});

test('actions and camera follow the native tracking rules', () => {
  assert.equal(customerCanCancelDelivery('RIDER_ASSIGNED'), true);
  assert.equal(customerCanCancelDelivery('COLLECTED'), false);
  assert.equal(deliveryActions(detail()).cancel, true);
  assert.equal(deliveryActions(detail()).contact, true);
  assert.equal(deliveryActions(detail({ status: 'NO_RIDER_FOUND', serviceClass: 'EXPRESS', rider: null, riderLocation: null, pickupApproach: null })).searchAgain, true);
  assert.equal(deliveryActions(detail({ status: 'NO_RIDER_FOUND', serviceClass: 'EXPRESS', rider: null, riderLocation: null, pickupApproach: null })).deleteRequest, true);
  const camera = trackingCameraRegion({ latitude: -17.82, longitude: 31.05 }, { latitude: -17.821, longitude: 31.051 });
  assert.ok(camera.latitudeDelta > 0.01);
  assert.equal(camera.longitudeDelta, 0.01);
  assert.deepEqual(trackingCameraShouldMove(false, true), { move: true, gestured: false });
  assert.deepEqual(trackingCameraShouldMove(true, true), { move: false, gestured: true });
  assert.equal(showsTrackingRoute(1), false);
  assert.equal(showsTrackingRoute(2), true);
  const collecting = trackingMapView(detail({ status: 'COLLECTING' }), NOW);
  assert.equal(collecting.kind, 'live');
  if (collecting.kind === 'live') assert.equal(collecting.headingToDropoff, false);
  const delivering = trackingMapView(detail({ status: 'OUT_FOR_DELIVERY' }), NOW);
  assert.equal(delivering.kind, 'live');
  if (delivering.kind === 'live') assert.equal(delivering.stop?.latitude, -17.83);
  assert.equal(trackingMapView(detail({ status: 'DELIVERED', riderLocation: null, pickupApproach: null }), NOW).kind, 'hidden');
  assert.equal(trackingMapView(detail({ status: 'CANCELLED', riderLocation: null, pickupApproach: null }), NOW).kind, 'hidden');
  assert.equal(shouldPollDelivery(detail({ status: 'COLLECTED' })), true);
  assert.equal(shouldPollDelivery(detail({ status: 'CANCELLED' })), false);
});

function bid(id: string, amount: string, rides: number): CustomerBid {
  return {
    id,
    deliveryId: 'delivery-1',
    amount,
    currency: 'USD',
    status: 'OPEN',
    riderName: id,
    completedDeliveries: rides,
    averageRating: null,
    ratingCount: 0,
    riderClass: 'SILVER',
    pickupEtaSeconds: null,
    motorcycle: null,
    registrationNumber: null,
    hasProfilePhoto: false,
    mapPoint: null,
  };
}

test('offers sort by price or rides, and price entry stays within the native limits', () => {
  const sorted = sortRiderOffers([bid('b', '8.00', 1), bid('a', '4.00', 9)], 'price');
  assert.deepEqual(sorted.map((item) => item.id), ['a', 'b']);
  assert.deepEqual(sortRiderOffers([bid('b', '8.00', 1), bid('a', '4.00', 9)], 'rides-low').map((item) => item.id), ['b', 'a']);
  assert.equal(offerFieldText('12.345'), '12.34');
  assert.deepEqual(customerOfferForBooking('4.5'), { offeredPrice: '4.50' });
  assert.equal('error' in customerOfferForBooking('0'), true);
  assert.equal(deliveryActions(detail({ status: 'NO_RIDER_FOUND', rider: null, riderLocation: null, pickupApproach: null })).adjustPrice, true);
  assert.equal(deliveryActions(detail()).adjustPrice, false);
});

test('rider confirmation, completed route, and photo fallback follow the native rules', () => {
  assert.equal(shouldShowRiderConfirmed('delivery-1', 'delivery-1', false), true);
  assert.equal(shouldShowRiderConfirmed('delivery-1', 'delivery-1', true), false);
  assert.equal(shouldShowRiderConfirmed(null, 'delivery-1', false), false);
  assert.equal(receivedOfferCountLabel(1), '1 offer');
  assert.equal(receivedOfferCountLabel(2), '2 offers');
  assert.equal(offersMissingSince(['a'], ['a', 'b']), false);
  assert.equal(offersMissingSince(['a', 'b'], ['b']), true);
  const gate = createAcceptanceGate();
  assert.equal(duplicateAcceptanceNotice(gate.begin()), null);
  assert.equal(duplicateAcceptanceNotice(gate.begin()), 'Rider selection is already in progress.');
  gate.end();
  const store = memoryStore();
  assert.equal(acceptanceKeyFor(store, 'delivery-1', 'bid-1', () => 'key-1'), 'key-1');
  assert.equal(acceptanceKeyFor(store, 'delivery-1', 'bid-1', () => 'key-2'), 'key-1');
  clearAcceptanceKey(store, 'delivery-1', 'bid-1');
  assert.equal(acceptanceKeyFor(store, 'delivery-1', 'bid-1', () => 'key-3'), 'key-3');
  assert.equal(readBidAcceptance({
    deliveryId: 'delivery-1',
    bidId: 'bid-1',
    status: 'RIDER_ASSIGNED',
    acceptedBidAmount: '4.50',
    replayed: false,
  }).status, 'RIDER_ASSIGNED');
  assert.throws(() => readBidAcceptance({ status: 'OPEN' }), /could not be accepted/);
  assert.equal(showsCompletedRoute(detail({ status: 'PICKED_UP', riderLocation: null, pickupApproach: null })), true);
  assert.equal(showsCompletedRoute(detail({ status: 'DELIVERED', riderLocation: null, pickupApproach: null })), false);
  assert.equal(readRouteLine({ line: [{ latitude: -17.8, longitude: 31 }, { latitude: 99, longitude: 0 }] }).length, 1);
  assert.equal(riderPhotoPresentation({ hasProfilePhoto: true, photoUrl: null, failed: false }), 'initials');
  assert.equal(riderPhotoPresentation({ hasProfilePhoto: true, photoUrl: 'blob:photo', failed: false }), 'photo');
  assert.equal(riderPhotoPresentation({ hasProfilePhoto: true, photoUrl: 'blob:photo', failed: true }), 'initials');
});

function memoryStore() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}
