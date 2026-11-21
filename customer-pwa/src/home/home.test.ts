import assert from 'node:assert/strict';
import test from 'node:test';
import { HARARE, INITIAL_SPAN, NEIGHBORHOOD_SPAN, cameraFor, shouldAutoFrame } from './camera.ts';
import { CUSTOMER_LOCATION_DOT, customerLocationIcon } from './customerLocation.ts';
import { markerRotation, motorcycleMarkerDisplaySize, MOTORCYCLE_NOSE_CLOCKWISE_DEGREES, NATIVE_MOTORCYCLE_MARKER } from './motorcycleMarker.ts';
import {
  filterValidNearbyRiderPoints,
  locationFromGeolocationError,
  nearbyHomeCountLabel,
  nextNearbyMarkers,
  readNearbyRiderMap,
  type NearbyMarker,
} from './nearby.ts';

const future = new Date(Date.now() + 60_000).toISOString();
const past = new Date(Date.now() - 60_000).toISOString();

test('the first camera is Harare and a later fix stays locked', () => {
  assert.equal(HARARE.latitude, -17.8292);
  assert.equal(HARARE.longitude, 31.0522);
  assert.equal(INITIAL_SPAN, 0.07);
  assert.equal(NEIGHBORHOOD_SPAN, 0.027);
  const initial = cameraFor({
    center: HARARE,
    size: { width: 390, height: 700 },
    span: INITIAL_SPAN,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    pin: null,
  });
  assert.equal(initial.center.latitude, HARARE.latitude);
  const customer = { latitude: -17.8, longitude: 31.04 };
  const framed = cameraFor({
    center: customer,
    size: { width: 390, height: 700 },
    span: NEIGHBORHOOD_SPAN,
    padding: { top: 48, right: 24, bottom: 220, left: 24 },
    pin: customer,
  });
  assert.ok(framed.center.latitude < customer.latitude);
  assert.equal(framed.center.longitude, customer.longitude);
  assert.equal(shouldAutoFrame({ gestured: false, locked: false, customer, cardHeight: 220 }), true);
  assert.equal(shouldAutoFrame({ gestured: true, locked: false, customer, cardHeight: 220 }), false);
  assert.equal(shouldAutoFrame({ gestured: false, locked: true, customer, cardHeight: 220 }), false);
  assert.equal(shouldAutoFrame({ gestured: false, locked: false, customer: null, cardHeight: 220 }), false);
});

test('motorcycle markers use whole pixels at the native bitmap size', () => {
  assert.equal(NATIVE_MOTORCYCLE_MARKER.width, 106);
  assert.equal(NATIVE_MOTORCYCLE_MARKER.height, 115);
  const phone = motorcycleMarkerDisplaySize(1.5);
  assert.equal(phone.width, 71);
  assert.equal(phone.height, 77);
  assert.equal(Number.isInteger(phone.width) && Number.isInteger(phone.height), true);
  const retina = motorcycleMarkerDisplaySize(3);
  assert.equal(retina.width, 35);
  assert.equal(retina.height, 38);
  assert.ok(retina.width > 0 && retina.height > 0);
  assert.equal(motorcycleMarkerDisplaySize(1).width, 106);
  assert.equal(motorcycleMarkerDisplaySize(0).height, 115);
});

const RIDERS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
] as const;

test('the motorcycle artwork offset points its front along a travel bearing', () => {
  assert.equal(MOTORCYCLE_NOSE_CLOCKWISE_DEGREES, 142);
  assert.equal(markerRotation(null), 0);
  assert.equal(markerRotation(Number.NaN), 0);
  assert.equal(markerRotation(142), 0);
  assert.equal(markerRotation(0), 218);
  assert.equal(markerRotation(90), 308);
});

test('nearby responses keep only unexpired approximate points', () => {
  const map = readNearbyRiderMap({
    count: 2,
    points: [
      { id: RIDERS[0], latitude: -17.8, longitude: 31.05, expiresAt: future },
      { id: RIDERS[1], latitude: -17.81, longitude: 31.06, expiresAt: past },
    ],
  });
  assert.equal(map.count, 1);
  assert.equal(map.points[0]?.id, RIDERS[0]);
  const mixed = readNearbyRiderMap({
    count: 2,
    points: [
      { id: RIDERS[0], latitude: 999, longitude: 31.05, expiresAt: future },
      { id: RIDERS[1], latitude: -17.82, longitude: 31.04, expiresAt: future },
      { latitude: -17.83, longitude: 31.07, expiresAt: future },
    ],
  });
  assert.equal(mixed.count, 1);
  assert.equal(mixed.points[0]?.id, RIDERS[1]);
  assert.throws(() => readNearbyRiderMap({ count: 0, points: [{ id: RIDERS[0], latitude: -17.8, longitude: 31.05, expiresAt: future }] }), /unavailable/);
});

test('stored nearby points keep their expiry and drop only the expired ones', () => {
  const points = [
    { id: RIDERS[0], latitude: -17.8, longitude: 31.05, expiresAt: future },
    { id: RIDERS[1], latitude: -17.81, longitude: 31.06, expiresAt: past },
  ];
  const kept = filterValidNearbyRiderPoints(points);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.id, RIDERS[0]);
});

test('each available rider keeps one marker and a failed refresh keeps it', () => {
  const points = RIDERS.map((id, index) => ({
    id,
    latitude: -17.8 - index * 0.01,
    longitude: 31.05 + index * 0.01,
    expiresAt: future,
  }));
  assert.equal(nextNearbyMarkers([], { status: 'ready', points: [] }).length, 0);
  const one = nextNearbyMarkers([], { status: 'ready', points: [points[0]!] });
  assert.deepEqual(one.map((point) => point.id), [RIDERS[0]]);
  const two = nextNearbyMarkers(one, { status: 'ready', points: points.slice(0, 2) });
  assert.deepEqual(two.map((point) => point.id), RIDERS.slice(0, 2));
  const five = nextNearbyMarkers(two, { status: 'ready', points });
  assert.deepEqual(five.map((point) => point.id), [...RIDERS]);
  const moved = nextNearbyMarkers(five, {
    status: 'ready',
    points: [{ ...points[0]!, latitude: -17.8004, longitude: 31.0504 }],
  });
  assert.deepEqual(moved.map((point) => point.id), [RIDERS[0]]);
  assert.equal(moved[0]?.latitude, -17.8004);
  const failed = nextNearbyMarkers(moved, { status: 'failed' });
  assert.equal(failed[0]?.id, RIDERS[0]);
  const expired: NearbyMarker[] = [{ id: RIDERS[0], latitude: -17.8, longitude: 31.05, expiresAt: past }];
  assert.equal(nextNearbyMarkers(expired, { status: 'failed' }).length, 0);
  const mixed = nextNearbyMarkers(
    [
      { id: RIDERS[0], latitude: -17.8, longitude: 31.05, expiresAt: future },
      { id: RIDERS[1], latitude: -17.81, longitude: 31.06, expiresAt: past },
    ],
    { status: 'failed' },
  );
  assert.deepEqual(mixed.map((point) => point.id), [RIDERS[0]]);
});

test('the customer location marker is a blue dot and not a motorcycle', () => {
  const icon = customerLocationIcon(0);
  assert.equal(icon.path, 0);
  assert.equal(icon.fillColor, '#1A73E8');
  assert.equal(icon.fillColor, CUSTOMER_LOCATION_DOT.fillColor);
  assert.equal(icon.scale, 6);
  assert.equal('url' in icon, false);
});

test('location and rider status labels match the customer app', () => {
  assert.equal(nearbyHomeCountLabel({ status: 'loading' }), 'Checking');
  assert.equal(nearbyHomeCountLabel({ status: 'services-off' }), 'Location is off');
  assert.equal(nearbyHomeCountLabel({ status: 'permission-denied', canAskAgain: false }), 'Location needed');
  assert.equal(nearbyHomeCountLabel({ status: 'position-unavailable' }), 'Location unavailable');
  assert.equal(nearbyHomeCountLabel({ status: 'check-failed', message: 'offline' }), 'Unable to check');
  assert.equal(nearbyHomeCountLabel({ status: 'ready', count: 0 }), '0 riders nearby');
  assert.equal(nearbyHomeCountLabel({ status: 'ready', count: 1 }), '1 rider nearby');
  assert.equal(nearbyHomeCountLabel({ status: 'ready', count: 2 }), '2 riders nearby');
  assert.equal(locationFromGeolocationError({ code: 1 }).status, 'permission-denied');
  assert.equal(locationFromGeolocationError({ code: 2, message: 'Location services are disabled' }).status, 'services-off');
  assert.equal(locationFromGeolocationError({ code: 3 }).status, 'position-unavailable');
});
