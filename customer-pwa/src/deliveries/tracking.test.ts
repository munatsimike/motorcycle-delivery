import assert from 'node:assert/strict';
import test from 'node:test';
import { moneyLabel } from './rules.ts';
import { zoomForSpan } from '../home/camera.ts';
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
  offersFrameHolds,
  offersMapCamera,
  offersMissingSince,
  readBidAcceptance,
  readCustomerBids,
  readCustomerDeliveryDetail,
  activeCustomerBids,
  activeOfferCountLabel,
  receivedOfferCountLabel,
  readRouteLine,
  activeStopStraightLineMetres,
  advanceMotorcycleHeading,
  dropoffStraightLineMetres,
  pickupDistanceTag,
  pickupStraightLineMetres,
  riderFixIsFresh,
  roadDistanceLabel,
  smoothHeading,
  straightLineMetres,
  trackingHeadline,
  offerRiderName,
  riderPhotoPresentation,
  shouldPollDelivery,
  shouldShowRiderConfirmed,
  showsCompletedRoute,
  sortRiderOffers,
  showsTrackingRoute,
  trackingCameraRegion,
  trackingCameraShouldMove,
  trackingFrameHolds,
  trackingRouteCamera,
  TRACKING_SHEET_OVERLAP,
  TRACKING_PIN_CLEARANCE,
  TRACKING_SIDE_PADDING,
  TRACKING_TOP_CHROME,
  trackingMapView,
  offerMapMarkers,
  riderMarkerForMap,
  withoutBidMapPoints,
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
    pickupContactPhone: null,
    pickupLandmark: null,
    pickupInstructions: null,
    recipientPhone: null,
    dropoffLandmark: null,
    dropoffInstructions: null,
    parcelSize: null,
    parcelInstructions: null,
    paymentMethod: null,
    cancellation: null,
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
  assert.equal(deliveryScreen(detail({ status: 'SEARCHING', riderLocation: null, pickupApproach: null })), 'status');
  assert.equal(deliveryScreen(detail({ status: 'ASSIGNED', riderLocation: null, pickupApproach: null })), 'status');
  assert.equal(deliveryScreen(detail({ status: 'ARRIVED_AT_PICKUP', riderLocation: null, pickupApproach: null })), 'status');
  assert.equal(deliveryScreen(detail({ status: 'CREATED', serviceClass: null, riderLocation: null, pickupApproach: null })), 'status');
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
  assert.equal(riderMarkerForMap(stale), null);
  assert.deepEqual(riderMarkerForMap(fresh), { latitude: -17.821, longitude: 31.051 });
  const offlineAssigned = trackingMapView(detail(), NOW);
  assert.equal(offlineAssigned.kind, 'live');
  assert.deepEqual(riderMarkerForMap(offlineAssigned), { latitude: -17.821, longitude: 31.051 });
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
  const route = [
    { latitude: -17.82, longitude: 31.04 },
    { latitude: -17.78, longitude: 31.02 },
    { latitude: -17.76, longitude: 31.09 },
  ];
  const width = 390;
  const height = 640;
  const framed = trackingRouteCamera(route, width, height, TRACKING_SHEET_OVERLAP);
  const withRider = trackingRouteCamera(route, width, height, TRACKING_SHEET_OVERLAP, { includeRider: true, includeTag: true });
  const zoom = Math.min(zoomForSpan(framed.latitudeDelta, height), zoomForSpan(framed.longitudeDelta, width));
  const riderZoom = Math.min(zoomForSpan(withRider.latitudeDelta, height), zoomForSpan(withRider.longitudeDelta, width));
  const tight = Math.min(zoomForSpan(0.06, height), zoomForSpan(0.07, width));
  assert.ok(zoom > tight - 0.35);
  assert.ok(riderZoom > tight - 0.55);
  const degrees = 360 / (256 * 2 ** zoom);
  for (const point of route) {
    const x = width / 2 + (point.longitude - framed.longitude) / degrees;
    const y = height / 2 - (point.latitude - framed.latitude) / degrees;
    assert.ok(x >= TRACKING_SIDE_PADDING - 2 && x <= width - TRACKING_SIDE_PADDING + 2);
    assert.ok(y >= TRACKING_TOP_CHROME + 24 - 2 && y <= height - TRACKING_SHEET_OVERLAP - TRACKING_PIN_CLEARANCE + 2);
  }
  assert.equal(trackingFrameHolds(route, framed, width, height, TRACKING_SHEET_OVERLAP), true);
  assert.equal(trackingFrameHolds(route, withRider, width, height, TRACKING_SHEET_OVERLAP, { includeRider: true, includeTag: true }), true);
  const short = trackingRouteCamera(
    [{ latitude: -17.82, longitude: 31.05 }, { latitude: -17.8204, longitude: 31.0504 }],
    width,
    height,
    TRACKING_SHEET_OVERLAP,
  );
  assert.ok(short.latitudeDelta < 0.002);
  const drifted = route.map((point) => ({ latitude: point.latitude + 0.0002, longitude: point.longitude }));
  assert.equal(trackingFrameHolds(drifted, framed, width, height, TRACKING_SHEET_OVERLAP), true);
  assert.equal(trackingFrameHolds([{ latitude: -17.7, longitude: 31.2 }], framed, width, height, TRACKING_SHEET_OVERLAP), false);
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
  assert.equal(deliveryScreen(detail({ status: 'CANCELLED', riderLocation: null, pickupApproach: null })), 'outcome');
  assert.equal(deliveryActions(detail({ status: 'CANCELLED', riderLocation: null, pickupApproach: null })).offers, false);
  assert.equal(deliveryActions(detail({ status: 'CANCELLED', riderLocation: null, pickupApproach: null })).cancel, false);
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

test('offer markers follow the latest bid point and drop when it is gone', () => {
  const placed = { ...bid('ada', '4.00', 1), riderName: 'Ada', mapPoint: { latitude: -17.82, longitude: 31.05 } };
  const hidden = bid('busi', '5.00', 2);
  assert.deepEqual(offerMapMarkers([placed, hidden]), [{ latitude: -17.82, longitude: 31.05, title: 'Ada' }]);
  const cleared = withoutBidMapPoints([placed, hidden]);
  assert.equal(cleared[0]?.mapPoint, null);
  assert.equal(cleared[0]?.amount, '4.00');
  assert.equal(cleared[0]?.status, 'OPEN');
  assert.deepEqual(offerMapMarkers(cleared), []);
});

test('the bids heading counts only active offers', () => {
  const dismissed = new Set(['gone']);
  const bids = [
    bid('open', '4.00', 1),
    { ...bid('gone', '5.00', 2) },
    { ...bid('withdrawn', '6.00', 3), status: 'WITHDRAWN' as const },
    { ...bid('expired', '7.00', 4), status: 'EXPIRED' as const },
    { ...bid('accepted', '8.00', 5), status: 'ACCEPTED' as const },
    { ...bid('replaced', '9.00', 6), status: 'SUPERSEDED' as const },
    bid('fresh', '3.00', 7),
  ];
  const active = activeCustomerBids(bids, dismissed);
  assert.deepEqual(active.map((item) => item.id), ['open', 'fresh']);
  assert.equal(activeOfferCountLabel(active.length), '2 offers received');
  assert.equal(activeOfferCountLabel(1), '1 offer received');
  assert.equal(activeOfferCountLabel(0), '0 offers received');
  assert.deepEqual(activeCustomerBids([bid('fresh', '3.00', 7)], dismissed).map((item) => item.id), ['fresh']);
});

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
  assert.equal(showsCompletedRoute(detail({ status: 'IN_TRANSIT', riderLocation: null, pickupApproach: null })), true);
  assert.equal(showsCompletedRoute(detail({ status: 'DELIVERED', riderLocation: null, pickupApproach: null })), false);
  assert.equal(readRouteLine({ line: [{ latitude: -17.8, longitude: 31 }, { latitude: 99, longitude: 0 }] }).length, 1);
  assert.equal(riderPhotoPresentation({ hasProfilePhoto: true, photoUrl: null, failed: false }), 'initials');
  assert.equal(riderPhotoPresentation({ hasProfilePhoto: true, photoUrl: 'blob:photo', failed: false }), 'photo');
  assert.equal(riderPhotoPresentation({ hasProfilePhoto: true, photoUrl: 'blob:photo', failed: true }), 'initials');
  assert.equal(offerRiderName('Michael Banda'), 'Michael B.');
  assert.equal(offerRiderName('Michael'), 'Michael');
  assert.equal(offerRiderName('  Michael   John   Banda  '), 'Michael B.');
  assert.equal(offerRiderName(''), 'Rider');
  assert.equal(offerRiderName('   '), 'Rider');
});

test('offers camera keeps pickup and riders above a short sheet', () => {
  const pickup = { latitude: -17.82, longitude: 31.05 };
  const riders = [
    { latitude: -17.828, longitude: 31.046 },
    { latitude: -17.814, longitude: 31.056 },
  ];
  const points = [pickup, ...riders];
  const frame = offersMapCamera(points, 360, 280);
  assert.equal(offersFrameHolds(points, frame, 360, 280), true);
  const zoom = Math.min(zoomForSpan(frame.latitudeDelta, 280), zoomForSpan(frame.longitudeDelta, 360));
  const degreesPerPixel = 360 / (256 * 2 ** zoom);
  for (const point of points) {
    const y = 280 / 2 - (point.latitude - frame.latitude) / degreesPerPixel;
    assert.ok(y <= 280 - 72, `marker at ${y} sits behind the sheet`);
    assert.ok(y >= 8, `marker at ${y} is clipped by the top`);
  }
  const nudged = points.map((point) => ({ latitude: point.latitude + 0.00005, longitude: point.longitude }));
  assert.equal(offersFrameHolds(nudged, frame, 360, 280), true);
  assert.equal(offersFrameHolds([{ latitude: -17.9, longitude: 31.05 }], frame, 360, 280), false);
});

test('a cancelled delivery keeps the actor and omits the rider note', () => {
  const parsed = readCustomerDeliveryDetail({
    id: 'delivery-9',
    status: 'CANCELLED',
    currency: 'USD',
    offeredPrice: null,
    suggestedPrice: '3.00',
    serviceClass: 'FLEXIBLE',
    deliverBy: null,
    distanceMeters: 10,
    paymentMethod: 'CASH',
    pickup: { address: 'Pickup road', contactName: 'Sender', contactPhone: '+263771111111', latitude: '-17.8200000', longitude: '31.0500000' },
    dropoff: { address: 'Dropoff road', contactName: 'Recipient', contactPhone: '+263772222222', latitude: '-17.8300000', longitude: '31.0600000' },
    parcel: { description: 'Documents', size: 'MEDIUM', instructions: 'Handle gently' },
    cancellation: { actor: 'RIDER', reason: 'BREAKDOWN', afterPickup: false, note: 'private gate note' },
  });
  assert.deepEqual(parsed.cancellation, { actor: 'RIDER', reason: 'BREAKDOWN', afterPickup: false });
  assert.equal(JSON.stringify(parsed).includes('private gate note'), false);
  assert.equal(parsed.senderName, 'Sender');
  assert.equal(parsed.recipientPhone, '+263772222222');
  assert.equal(parsed.parcelSize, 'MEDIUM');
  assert.equal(deliveryActions(parsed).offers, false);
  assert.equal(deliveryScreen(parsed), 'outcome');
  const zig = readCustomerDeliveryDetail({
    id: 'delivery-zig',
    status: 'CREATED',
    currency: 'ZWG',
    offeredPrice: '99.00',
    suggestedPrice: '99.00',
    serviceClass: 'FLEXIBLE',
    deliverBy: null,
    distanceMeters: 10,
    paymentMethod: 'CASH',
    pickup: { address: 'Pickup road', contactName: 'Sender', contactPhone: '+263771111111', latitude: '-17.8200000', longitude: '31.0500000' },
    dropoff: { address: 'Dropoff road', contactName: 'Recipient', contactPhone: '+263772222222', latitude: '-17.8300000', longitude: '31.0600000' },
    parcel: { description: 'Parcel', size: 'SMALL', instructions: null },
  });
  assert.equal(zig.currency, 'ZWG');
  assert.equal(moneyLabel(zig.currency, zig.offeredPrice ?? ''), 'ZiG 99');
  const offers = readCustomerBids([{
    id: 'bid-zig',
    deliveryId: 'delivery-zig',
    amount: '99.00',
    currency: 'ZWG',
    status: 'OPEN',
    rider: { name: 'Tendai Moyo', completedDeliveries: 2, riderClass: 'SILVER' },
  }]);
  assert.equal(offers[0]?.currency, 'ZWG');
  assert.equal(moneyLabel(offers[0]?.currency, offers[0]?.amount ?? ''), 'ZiG 99');
});

const EARTH_RADIUS_METRES = 6_371_000;

function riderNorthOf(metres: number, updatedAt: string) {
  return {
    latitude: -17.82 + (metres / EARTH_RADIUS_METRES) * (180 / Math.PI),
    longitude: 31.05,
    updatedAt,
  };
}

test('arrival uses straight-line distance and ignores the road route', () => {
  const fresh = new Date(NOW - 10_000).toISOString();
  const at = (metres: number, status: CustomerDeliveryDetail['status'] = 'COLLECTING') => detail({
    status,
    riderLocation: riderNorthOf(metres, fresh),
    pickupApproach: { metres: 484, seconds: 90, line: [] },
  });

  assert.equal(pickupStraightLineMetres(at(49), NOW), 49);
  assert.equal(trackingHeadline('COLLECTING', pickupStraightLineMetres(at(49), NOW)), 'Rider arrived');
  assert.equal(pickupStraightLineMetres(at(50), NOW), 50);
  assert.equal(trackingHeadline('RIDER_ASSIGNED', pickupStraightLineMetres(at(50, 'RIDER_ASSIGNED'), NOW)), 'Rider arrived');
  assert.equal(pickupStraightLineMetres(at(51), NOW), 51);
  assert.equal(trackingHeadline('COLLECTING', pickupStraightLineMetres(at(51), NOW)), 'Rider coming');

  const nearDoor = at(40);
  assert.equal(nearDoor.pickupApproach?.metres, 484);
  assert.equal(roadDistanceLabel(nearDoor.pickupApproach?.metres ?? 0), '484 m');
  assert.equal(pickupStraightLineMetres(nearDoor, NOW), 40);
  assert.equal(trackingHeadline(nearDoor.status, pickupStraightLineMetres(nearDoor, NOW)), 'Rider arrived');
  assert.equal(straightLineMetres(nearDoor.riderLocation!.latitude, nearDoor.riderLocation!.longitude, nearDoor.pickupLatitude!, nearDoor.pickupLongitude!), 40);
});

test('missing or stale GPS does not claim the rider has arrived', () => {
  const close = riderNorthOf(10, new Date(NOW - 61_000).toISOString());
  const stale = detail({ status: 'COLLECTING', riderLocation: close, pickupApproach: { metres: 20, seconds: 30, line: [] } });
  assert.equal(pickupStraightLineMetres(stale, NOW), null);
  assert.equal(trackingHeadline(stale.status, pickupStraightLineMetres(stale, NOW)), 'Rider coming');

  const missing = detail({ status: 'RIDER_ASSIGNED', riderLocation: null, pickupApproach: { metres: 10, seconds: 20, line: [] } });
  assert.equal(pickupStraightLineMetres(missing, NOW), null);
  assert.equal(trackingHeadline(missing.status, pickupStraightLineMetres(missing, NOW)), 'Rider coming');

  const unpinned = detail({ status: 'COLLECTING', pickupLatitude: null, pickupLongitude: null });
  assert.equal(pickupStraightLineMetres(unpinned, NOW), null);
  assert.equal(trackingHeadline(unpinned.status, pickupStraightLineMetres(unpinned, NOW)), 'Rider coming');
});

test('the distance tag says Arrived only inside 50 metres', () => {
  const fresh = new Date(NOW - 10_000).toISOString();
  const at = (metres: number, status: CustomerDeliveryDetail['status'] = 'COLLECTING') => detail({
    status,
    riderLocation: riderNorthOf(metres, fresh),
    pickupApproach: { metres: 477, seconds: 120, line: [] },
  });
  const tag = (delivery: CustomerDeliveryDetail) => {
    const straight = activeStopStraightLineMetres(delivery, NOW);
    return {
      headline: trackingHeadline(delivery.status, straight),
      tag: pickupDistanceTag(straight, delivery.pickupApproach?.metres, delivery.pickupApproach?.seconds),
    };
  };

  const far = tag(at(150));
  assert.equal(far.headline, 'Rider coming');
  assert.equal(far.tag, '477 m · 2 min');
  assert.equal(tag(at(49)).tag, 'Arrived');
  assert.equal(tag(at(49)).headline, 'Rider arrived');
  assert.equal(tag(at(50)).tag, 'Arrived');
  assert.equal(tag(at(50)).headline, 'Rider arrived');
  assert.equal(tag(at(51)).tag, '477 m · 2 min');
  assert.equal(tag(at(51)).headline, 'Rider coming');

  const stale = detail({
    status: 'COLLECTING',
    riderLocation: riderNorthOf(10, new Date(NOW - 61_000).toISOString()),
    pickupApproach: { metres: 477, seconds: 120, line: [] },
  });
  assert.equal(pickupDistanceTag(activeStopStraightLineMetres(stale, NOW), 477, 120), '477 m · 2 min');
  const missing = detail({ status: 'RIDER_ASSIGNED', riderLocation: null, pickupApproach: { metres: 477, seconds: 120, line: [] } });
  assert.equal(pickupDistanceTag(activeStopStraightLineMetres(missing, NOW), 477, 120), '477 m · 2 min');

  const delivering = (metres: number, updatedAt = fresh) => detail({
    status: 'COLLECTED',
    riderLocation: {
      latitude: -17.83 + (metres / EARTH_RADIUS_METRES) * (180 / Math.PI),
      longitude: 31.06,
      updatedAt,
    },
    pickupApproach: { metres: 477, seconds: 120, line: [] },
  });
  assert.equal(dropoffStraightLineMetres(delivering(49), NOW), 49);
  assert.equal(tag(delivering(49)).tag, 'Arrived');
  assert.equal(tag(delivering(49)).headline, 'Parcel collected');
  assert.equal(tag(delivering(50)).tag, 'Arrived');
  assert.equal(tag(delivering(51)).tag, '477 m · 2 min');
  assert.equal(trackingHeadline('COLLECTED', dropoffStraightLineMetres(delivering(51), NOW)), 'Parcel collected');
  const staleDropoff = delivering(10, new Date(NOW - 61_000).toISOString());
  assert.equal(dropoffStraightLineMetres(staleDropoff, NOW), null);
  assert.equal(pickupDistanceTag(activeStopStraightLineMetres(staleDropoff, NOW), 477, 120), '477 m · 2 min');
  const missingDropoff = detail({ status: 'OUT_FOR_DELIVERY', riderLocation: null, pickupApproach: { metres: 477, seconds: 120, line: [] } });
  assert.equal(dropoffStraightLineMetres(missingDropoff, NOW), null);
  assert.equal(pickupDistanceTag(activeStopStraightLineMetres(missingDropoff, NOW), 477, 120), '477 m · 2 min');
});

test('the motorcycle follows travel direction for collection and delivery', () => {
  const start = { latitude: -17.82, longitude: 31.05 };
  const idle = { heading: null, anchor: null };
  const parked = advanceMotorcycleHeading(idle, start);
  assert.equal(parked.heading, null);
  assert.deepEqual(parked.anchor, start);
  const jitter = advanceMotorcycleHeading(parked, northOf(start, 14));
  assert.equal(jitter.heading, null);
  assert.deepEqual(jitter.anchor, start);
  const north = advanceMotorcycleHeading(jitter, northOf(start, 40));
  assert.equal(north.heading, 0);
  const east = advanceMotorcycleHeading(north, eastOf(north.anchor ?? start, 40));
  assert.ok(east.heading != null && Math.abs(east.heading - 90) < 1);
  const held = advanceMotorcycleHeading(east, northOf(east.anchor ?? start, 8), 180);
  assert.equal(held.heading, east.heading);
  const reported = advanceMotorcycleHeading(held, northOf(held.anchor ?? start, 40), 180);
  assert.equal(reported.heading, 180);
  const collecting = advanceMotorcycleHeading(advanceMotorcycleHeading(idle, start), northOf(start, 40));
  const delivering = advanceMotorcycleHeading(advanceMotorcycleHeading(idle, start), northOf(start, 40));
  assert.equal(collecting.heading, delivering.heading);
  const awayFromPickup = advanceMotorcycleHeading(
    advanceMotorcycleHeading(idle, start),
    eastOf(start, 40),
  );
  assert.ok(awayFromPickup.heading != null && Math.abs(awayFromPickup.heading - 90) < 1);
  assert.equal(smoothHeading(null, 90, 0), 90);
  assert.equal(smoothHeading(10, 350, 0), 10);
  assert.equal(Math.round(smoothHeading(10, 350, 100) ?? 0), 356);
  assert.equal(smoothHeading(10, 350, 200), 350);
  assert.equal(smoothHeading(0, 90, 500), 70);
  const withBearing = readCustomerDeliveryDetail({
    id: 'delivery-1',
    status: 'COLLECTING',
    currency: 'USD',
    offeredPrice: '4.50',
    suggestedPrice: '3.00',
    serviceClass: 'EXPRESS',
    deliverBy: null,
    distanceMeters: 10,
    pickup: { address: 'Pickup', latitude: -17.8, longitude: 31 },
    dropoff: { address: 'Dropoff', latitude: -17.9, longitude: 31.1 },
    parcel: { description: 'Food' },
    riderLocation: { latitude: -17.81, longitude: 31.01, updatedAt: new Date(NOW).toISOString(), bearingDegrees: 450 },
    pickupApproach: { metres: 20, seconds: 40, line: [] },
    rider: { name: 'Ada Rider', verified: true, hasProfilePhoto: false },
    rating: { eligible: false, submitted: false },
  });
  assert.equal(withBearing.riderLocation?.bearingDegrees, 90);
  const view = trackingMapView(withBearing, NOW);
  assert.equal(view.kind === 'live' ? view.rider.bearingDegrees : null, 90);
});

test('collected deliveries keep their status headlines', () => {
  assert.equal(trackingHeadline('COLLECTED', 50), 'Parcel collected');
  assert.equal(trackingHeadline('OUT_FOR_DELIVERY', 50), 'Parcel collected');
  assert.equal(trackingHeadline('PICKED_UP', 50), 'Parcel collected');
  assert.equal(trackingHeadline('IN_TRANSIT', 75), 'Your parcel is on the way');
  assert.equal(trackingHeadline('ARRIVED_AT_DROPOFF', 75), 'Your parcel is on the way');
  assert.equal(trackingHeadline('DELIVERED', 0), 'Parcel delivered');
  const collected = detail({
    status: 'COLLECTED',
    riderLocation: riderNorthOf(50, new Date(NOW - 5_000).toISOString()),
    pickupApproach: { metres: 484, seconds: 90, line: [] },
  });
  assert.equal(pickupStraightLineMetres(collected, NOW), null);
  assert.equal(trackingHeadline(collected.status, pickupStraightLineMetres(collected, NOW)), 'Parcel collected');
});

function northOf(point: { latitude: number; longitude: number }, metres: number) {
  return {
    latitude: point.latitude + (metres / 6_371_000) * (180 / Math.PI),
    longitude: point.longitude,
  };
}

function eastOf(point: { latitude: number; longitude: number }, metres: number) {
  const cos = Math.cos(point.latitude * Math.PI / 180);
  return {
    latitude: point.latitude,
    longitude: point.longitude + (metres / (6_371_000 * cos)) * (180 / Math.PI),
  };
}

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
