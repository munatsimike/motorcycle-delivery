import { describe, expect, it } from 'vitest';

import { locationPresentation } from './marketplaceTracking';
import {
  mapTileImageSource,
  normalizeMapTileKey,
  readMapTileProvider,
  riderMapFrame,
  sameRiderTile,
  MAP_TILE_ATTRIBUTION,
  MAP_TILE_USER_AGENT,
  RIDER_MAP_ZOOM,
} from './riderMapTile';
import type { CustomerDeliveryDetail } from './customerDeliveryDetail';

const DELIVERY = 'delivery-1';
const HARARE = { deliveryId: DELIVERY, latitude: -17.8292, longitude: 31.0522, updatedAt: null };

function collecting(id: string, riderLocation: CustomerDeliveryDetail['riderLocation']): CustomerDeliveryDetail {
  return {
    id,
    status: 'COLLECTING',
    currency: 'USD',
    offeredPrice: '9.00',
    suggestedPrice: '8.00',
    serviceClass: 'FLEXIBLE',
    deliverBy: null,
    distanceMeters: 100,
    pickupAddress: 'Pickup road',
    pickupLatitude: null,
    pickupLongitude: null,
    dropoffAddress: 'Drop-off road',
    dropoffLatitude: null,
    dropoffLongitude: null,
    parcelDescription: 'Box',
    createdAt: null,
    riderLocation,
    pickupApproach: null,
    rider: null,
  };
}

const TILE_KEY = 'test-map-key-0001';
const configured = readMapTileProvider({ EXPO_PUBLIC_MAP_TILE_KEY: TILE_KEY });

describe('rider location map', () => {
  it('builds one MapTiler tile for an active collecting rider and hides it when the screen is inactive', () => {
    const visible = locationPresentation(DELIVERY, collecting(DELIVERY, { latitude: HARARE.latitude, longitude: HARARE.longitude, updatedAt: null }));
    expect(visible.kind).toBe('rider');
    const point = visible.kind === 'rider' ? visible : null;
    const frame = riderMapFrame(true, point, configured);
    expect(frame?.url).toBe(`https://api.maptiler.com/maps/streets-v4/256/${RIDER_MAP_ZOOM}/19210/18033.png?key=${TILE_KEY}`);
    expect(frame?.url).not.toContain('openstreetmap.org');
    expect(frame?.url).not.toContain('Pickup');
    expect(frame?.url).not.toContain(DELIVERY);
    expect(frame?.attribution).toBe(MAP_TILE_ATTRIBUTION);
    expect(frame?.markerX).toBeGreaterThanOrEqual(0);
    expect(frame?.markerX).toBeLessThan(1);
    expect(frame?.markerY).toBeGreaterThanOrEqual(0);
    expect(frame?.markerY).toBeLessThan(1);
    expect(mapTileImageSource(frame?.url ?? null)).toEqual({
      uri: frame?.url,
      headers: { 'User-Agent': MAP_TILE_USER_AGENT },
    });
    expect(riderMapFrame(false, point, configured)).toBeNull();
    expect(mapTileImageSource(null)).toBeNull();
  });

  it('keeps the same tile inside one cell, changes it at the boundary, and refuses invalid coordinates', () => {
    const first = riderMapFrame(true, HARARE, configured);
    const nearby = riderMapFrame(true, { ...HARARE, latitude: HARARE.latitude + 0.0004, longitude: HARARE.longitude + 0.0004 }, configured);
    expect(sameRiderTile(first, nearby)).toBe(true);
    expect(first?.markerX).not.toBe(nearby?.markerX);
    const nextTile = riderMapFrame(true, {
      deliveryId: DELIVERY,
      latitude: HARARE.latitude,
      longitude: longitudeForTile(19211, 0.1),
    }, configured);
    expect(sameRiderTile(first, nextTile)).toBe(false);
    expect(nextTile?.url).toContain('/19211/');
    expect(nextTile?.markerX).toBeGreaterThanOrEqual(0);
    expect(nextTile?.markerX).toBeLessThan(1);
    const otherDelivery = riderMapFrame(true, { ...HARARE, deliveryId: 'delivery-2' }, configured);
    expect(sameRiderTile(first, otherDelivery)).toBe(false);
    expect(otherDelivery?.url).toBe(first?.url);
    const bulawayo = riderMapFrame(true, { deliveryId: DELIVERY, latitude: -20.15, longitude: 28.58 }, configured);
    expect(sameRiderTile(first, bulawayo)).toBe(false);
    expect(bulawayo?.url).not.toBe(first?.url);
    for (const point of [
      { deliveryId: DELIVERY, latitude: 91, longitude: 31 },
      { deliveryId: DELIVERY, latitude: Number.NaN, longitude: 31 },
      { deliveryId: DELIVERY, latitude: -17.8, longitude: Number.POSITIVE_INFINITY },
      { deliveryId: DELIVERY, latitude: -17.8, longitude: 181 },
    ]) {
      expect(riderMapFrame(true, point, configured)).toBeNull();
    }
  });

  it('shows coordinates without a tile request when the provider key is missing or unsafe', () => {
    const missing = riderMapFrame(true, HARARE, readMapTileProvider({}));
    expect(missing?.url).toBeNull();
    expect(missing?.attribution).toBeNull();
    expect(mapTileImageSource(missing?.url ?? null)).toBeNull();
    expect(missing?.markerX).toBeGreaterThanOrEqual(0);
    expect(missing?.markerX).toBeLessThan(1);
    for (const value of ['', '   ', 'short-key', 'https://tile.openstreetmap.org/15/1/1.png', `key-with-${'openstreetmap'}-host`]) {
      expect(normalizeMapTileKey(value)).toBeNull();
      expect(readMapTileProvider({ EXPO_PUBLIC_MAP_TILE_KEY: value }).kind).toBe('unconfigured');
    }
    expect(mapTileImageSource('https://tile.openstreetmap.org/15/1/1.png')).toBeNull();
    expect(configured.tileUrl(1.5, 2, RIDER_MAP_ZOOM)).toBeNull();
    expect(configured.tileUrl(-1, 0, RIDER_MAP_ZOOM)).toBeNull();
  });

  it('frames an assigned rider and drops the frame once the parcel is collected', () => {
    expect(riderMapFrame(true, null, configured)).toBeNull();
    const assigned = locationPresentation(DELIVERY, { ...collecting(DELIVERY, HARARE), status: 'RIDER_ASSIGNED' });
    expect(assigned.kind).toBe('rider');
    expect(riderMapFrame(true, assigned.kind === 'rider' ? assigned : null, configured)?.url).toBeTruthy();
    const collected = locationPresentation(DELIVERY, { ...collecting(DELIVERY, HARARE), status: 'COLLECTED' });
    expect(collected).toEqual({ kind: 'none' });
    expect(riderMapFrame(true, collected.kind === 'rider' ? collected : null, configured)).toBeNull();
  });
});

function longitudeForTile(x: number, fraction: number): number {
  const size = 2 ** RIDER_MAP_ZOOM;
  return ((x + fraction) / size) * 360 - 180;
}
