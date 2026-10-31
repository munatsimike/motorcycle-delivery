import { describe, expect, it } from 'vitest';
import {
  MIN_CAMERA_SPAN_METRES,
  MIN_REGION_DELTA,
  TRACKING_MAP_HEIGHT,
  TRACKING_MARKER_CLEARANCE,
  TRACKING_SHEET_OVERLAP,
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

  it('keeps a same-point fix at least a kilometre across above the sheet', () => {
    const arrived = { latitude: -17.8, longitude: 31.05 };
    const region = trackingCameraRegion(arrived, arrived);
    expect(region.longitude).toBeCloseTo(arrived.longitude, 6);
    expect(region.longitudeDelta).toBe(MIN_REGION_DELTA);
    expect(openSpan(region)).toBeCloseTo(MIN_REGION_DELTA, 6);
    expect(insideOpenBand(arrived.latitude, region)).toBe(true);
  });

  it('keeps a distant pickup wider than the closest frame and above the sheet', () => {
    const pickup = { latitude: rider.latitude + 5_000 / 111_320, longitude: rider.longitude };
    const region = trackingCameraRegion(rider, pickup);
    expect(region.latitudeDelta).toBeGreaterThan(MIN_REGION_DELTA);
    expect(openSpan(region)).toBeCloseTo(5_000 / 111_320, 6);
    expect(insideOpenBand(rider.latitude, region)).toBe(true);
    expect(insideOpenBand(pickup.latitude, region)).toBe(true);
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
