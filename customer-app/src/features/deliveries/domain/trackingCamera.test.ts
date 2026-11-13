import { describe, expect, it } from 'vitest';
import {
  MIN_CAMERA_SPAN_METRES,
  TRACKING_MAP_HEIGHT,
  TRACKING_MARKER_CLEARANCE,
  TRACKING_SHEET_OVERLAP,
  TRACKING_ZOOM_DELTA,
  fittedRouteRegion,
  trackingCameraPoints,
  trackingCameraRegion,
  type CameraRegion,
} from './trackingCamera';

const rider = { latitude: 52.387, longitude: 4.638 };

describe('tracking camera', () => {
  it('keeps a street-level frame when the rider and pickup are the same point', () => {
    const [southWest, northEast] = trackingCameraPoints(rider, rider);
    expect(northEast.latitude - southWest.latitude).toBeCloseTo(MIN_CAMERA_SPAN_METRES / 111_320, 6);
    expect(northEast.longitude - southWest.longitude).toBeGreaterThan(northEast.latitude - southWest.latitude);
    expect((southWest.latitude + northEast.latitude) / 2).toBeCloseTo(rider.latitude, 6);
    expect((southWest.longitude + northEast.longitude) / 2).toBeCloseTo(rider.longitude, 6);
  });

  it('fits a distant pickup instead of the minimum frame', () => {
    const pickup = { latitude: rider.latitude + 5_000 / 111_320, longitude: rider.longitude };
    const [southWest, northEast] = trackingCameraPoints(rider, pickup);
    expect(northEast.latitude - southWest.latitude).toBeCloseTo(5_000 / 111_320, 6);
    expect(northEast.longitude - southWest.longitude).toBeCloseTo(trackingCameraPoints(rider, rider)[1].longitude - trackingCameraPoints(rider, rider)[0].longitude, 4);
    expect(southWest.latitude).toBeCloseTo(rider.latitude, 6);
    expect(northEast.latitude).toBeCloseTo(pickup.latitude, 6);
  });

  it('frames the rider alone with the same minimum area', () => {
    expect(trackingCameraPoints(rider, null)).toEqual(trackingCameraPoints(rider, rider));
  });

  it('uses one zoom for a nearby stop and a distant stop', () => {
    const nearby = { latitude: rider.latitude + 0.002, longitude: rider.longitude + 0.001 };
    const distant = { latitude: rider.latitude + 5_000 / 111_320, longitude: rider.longitude };
    const closeFrame = trackingCameraRegion(rider, nearby);
    const farFrame = trackingCameraRegion(rider, distant);
    expect(closeFrame.latitudeDelta).toBe(farFrame.latitudeDelta);
    expect(closeFrame.longitudeDelta).toBe(farFrame.longitudeDelta);
    expect(closeFrame.longitudeDelta).toBe(TRACKING_ZOOM_DELTA);
    expect(openSpan(closeFrame)).toBeCloseTo(TRACKING_ZOOM_DELTA, 6);
  });

  it('centers a nearby pickup and a nearby drop-off the same way', () => {
    const pickup = { latitude: rider.latitude + 0.002, longitude: rider.longitude - 0.001 };
    const dropoff = { latitude: rider.latitude - 0.002, longitude: rider.longitude + 0.001 };
    const toPickup = trackingCameraRegion(rider, pickup);
    const toDropoff = trackingCameraRegion(rider, dropoff);
    expect(toPickup.latitudeDelta).toBe(toDropoff.latitudeDelta);
    expect(toPickup.longitudeDelta).toBe(toDropoff.longitudeDelta);
    expect(toPickup.longitude).toBeCloseTo((rider.longitude + pickup.longitude) / 2, 6);
    expect(toDropoff.longitude).toBeCloseTo((rider.longitude + dropoff.longitude) / 2, 6);
    expect(insideOpenBand(rider.latitude, toPickup)).toBe(true);
    expect(insideOpenBand(pickup.latitude, toPickup)).toBe(true);
    expect(insideOpenBand(rider.latitude, toDropoff)).toBe(true);
    expect(insideOpenBand(dropoff.latitude, toDropoff)).toBe(true);
  });

  it('keeps the rider in frame at the standard zoom when the destination is too far', () => {
    const dropoff = { latitude: rider.latitude + 5_000 / 111_320, longitude: rider.longitude };
    const region = trackingCameraRegion(rider, dropoff);
    const widened = fittedRouteRegion(rider, dropoff);
    expect(region.latitudeDelta).toBe(trackingCameraRegion(rider, rider).latitudeDelta);
    expect(region.latitudeDelta).toBeLessThan(widened.latitudeDelta);
    expect(region.longitude).toBeCloseTo(rider.longitude, 6);
    expect(insideOpenBand(rider.latitude, region)).toBe(true);
    expect(insideOpenBand(dropoff.latitude, region)).toBe(false);
  });

  it('frames the rider alone when the destination is missing', () => {
    const alone = trackingCameraRegion(rider, null);
    expect(alone).toEqual(trackingCameraRegion(rider, rider));
    expect(insideOpenBand(rider.latitude, alone)).toBe(true);
  });
});

function openSpan(region: CameraRegion): number {
  return region.latitudeDelta * (TRACKING_MAP_HEIGHT - TRACKING_SHEET_OVERLAP - TRACKING_MARKER_CLEARANCE) / TRACKING_MAP_HEIGHT;
}

function insideOpenBand(latitude: number, region: CameraRegion): boolean {
  const north = region.latitude + region.latitudeDelta / 2;
  const pinLimit = north - region.latitudeDelta * (TRACKING_MARKER_CLEARANCE / TRACKING_MAP_HEIGHT);
  const sheetLimit = north - region.latitudeDelta * ((TRACKING_MAP_HEIGHT - TRACKING_SHEET_OVERLAP) / TRACKING_MAP_HEIGHT);
  return latitude <= pinLimit + 1e-9 && latitude >= sheetLimit - 1e-9;
}
