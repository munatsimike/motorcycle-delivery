import assert from 'node:assert/strict';
import test from 'node:test';
import { HARARE, INITIAL_SPAN, NEIGHBORHOOD_SPAN, cameraFor, shouldAutoFrame } from './camera.ts';
import {
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

test('nearby responses keep only unexpired approximate points', () => {
  const map = readNearbyRiderMap({
    count: 2,
    points: [
      { latitude: -17.8, longitude: 31.05, expiresAt: future },
      { latitude: -17.81, longitude: 31.06, expiresAt: past },
    ],
  });
  assert.equal(map.count, 1);
  assert.equal(map.points[0]?.latitude, -17.8);
  assert.throws(() => readNearbyRiderMap({ count: 0, points: [{ latitude: -17.8, longitude: 31.05, expiresAt: future }] }), /unavailable/);
});

test('rider markers keep their identity and survive a failed refresh', () => {
  let next = 0;
  const createId = () => `nearby-marker-${next += 1}`;
  const first = nextNearbyMarkers([], { status: 'ready', points: [{ latitude: -17.8, longitude: 31.05, expiresAt: future }] }, createId);
  const moved = nextNearbyMarkers(first, {
    status: 'ready',
    points: [{ latitude: -17.8004, longitude: 31.0504, expiresAt: future }],
  }, createId);
  assert.equal(moved[0]?.id, first[0]?.id);
  const failed = nextNearbyMarkers(moved, { status: 'failed' }, createId);
  assert.equal(failed.length, 1);
  const expired: NearbyMarker[] = [{ id: 'nearby-marker-9', latitude: -17.8, longitude: 31.05, expiresAt: past }];
  assert.equal(nextNearbyMarkers(expired, { status: 'failed' }, createId).length, 0);
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
