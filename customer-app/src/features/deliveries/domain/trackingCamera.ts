export type CameraPoint = {
  latitude: number;
  longitude: number;
};

const METRES_PER_LATITUDE_DEGREE = 111_320;

/** Ground size of the fitted route map when its two corners are together. */
export const MIN_CAMERA_SPAN_METRES = 700;

/** Shared tracking zoom for every live status. About 1.1 km across. */
export const TRACKING_ZOOM_DELTA = 0.01;

/** Matches the Track delivery map frame. */
export const TRACKING_MAP_HEIGHT = 480;

/** How far the white sheet covers the bottom of the map. */
export const TRACKING_SHEET_OVERLAP = 72;

/** Pickup and rider pins are drawn above their coordinates. */
export const TRACKING_MARKER_CLEARANCE = 36;

export function trackingCameraPoints(rider: CameraPoint, pickup: CameraPoint | null): [CameraPoint, CameraPoint] {
  const points = pickup ? [rider, pickup] : [rider];
  let minLatitude = points[0].latitude;
  let maxLatitude = points[0].latitude;
  let minLongitude = points[0].longitude;
  let maxLongitude = points[0].longitude;
  for (const point of points) {
    minLatitude = Math.min(minLatitude, point.latitude);
    maxLatitude = Math.max(maxLatitude, point.latitude);
    minLongitude = Math.min(minLongitude, point.longitude);
    maxLongitude = Math.max(maxLongitude, point.longitude);
  }
  const latitude = (minLatitude + maxLatitude) / 2;
  const longitude = (minLongitude + maxLongitude) / 2;
  const latitudeSpan = Math.max(maxLatitude - minLatitude, latitudeDegrees(MIN_CAMERA_SPAN_METRES));
  const longitudeSpan = Math.max(maxLongitude - minLongitude, longitudeDegrees(MIN_CAMERA_SPAN_METRES, latitude));
  return [
    { latitude: latitude - latitudeSpan / 2, longitude: longitude - longitudeSpan / 2 },
    { latitude: latitude + latitudeSpan / 2, longitude: longitude + longitudeSpan / 2 },
  ];
}

export type CameraRegion = CameraPoint & {
  latitudeDelta: number;
  longitudeDelta: number;
};

/** Frames a completed route. Live tracking uses trackingCameraRegion instead. */
export function fittedRouteRegion(rider: CameraPoint, pickup: CameraPoint | null): CameraRegion {
  const [southWest, northEast] = trackingCameraPoints(rider, pickup);
  const fitted = {
    latitude: (southWest.latitude + northEast.latitude) / 2,
    longitude: (southWest.longitude + northEast.longitude) / 2,
    latitudeDelta: Math.max(northEast.latitude - southWest.latitude, TRACKING_ZOOM_DELTA),
    longitudeDelta: Math.max(northEast.longitude - southWest.longitude, TRACKING_ZOOM_DELTA),
  };
  return liftAboveSheet(fitted);
}

/**
 * One camera for pickup and drop-off tracking.
 * Centers on the rider and destination when both fit. Otherwise keeps the rider in frame
 * at the same zoom instead of zooming out.
 */
export function trackingCameraRegion(rider: CameraPoint, destination: CameraPoint | null): CameraRegion {
  const together = destination !== null && markersShareFrame(rider, destination);
  const focus = together && destination ? midpoint(rider, destination) : rider;
  return frameAt(focus);
}

function markersShareFrame(rider: CameraPoint, destination: CameraPoint): boolean {
  return Math.abs(rider.latitude - destination.latitude) <= TRACKING_ZOOM_DELTA
    && Math.abs(rider.longitude - destination.longitude) <= TRACKING_ZOOM_DELTA;
}

function midpoint(left: CameraPoint, right: CameraPoint): CameraPoint {
  return {
    latitude: (left.latitude + right.latitude) / 2,
    longitude: (left.longitude + right.longitude) / 2,
  };
}

function frameAt(focus: CameraPoint): CameraRegion {
  const openHeight = TRACKING_MAP_HEIGHT - TRACKING_SHEET_OVERLAP - TRACKING_MARKER_CLEARANCE;
  const latitudeDelta = TRACKING_ZOOM_DELTA * (TRACKING_MAP_HEIGHT / openHeight);
  const openCenter = TRACKING_MARKER_CLEARANCE + openHeight / 2;
  const southOfCenter = (TRACKING_MAP_HEIGHT / 2 - openCenter) / TRACKING_MAP_HEIGHT;
  return {
    latitude: focus.latitude - southOfCenter * latitudeDelta,
    longitude: focus.longitude,
    latitudeDelta,
    longitudeDelta: TRACKING_ZOOM_DELTA,
  };
}

function liftAboveSheet(region: CameraRegion): CameraRegion {
  const openHeight = TRACKING_MAP_HEIGHT - TRACKING_SHEET_OVERLAP - TRACKING_MARKER_CLEARANCE;
  const latitudeDelta = region.latitudeDelta * (TRACKING_MAP_HEIGHT / openHeight);
  const openCenter = TRACKING_MARKER_CLEARANCE + openHeight / 2;
  const southOfCenter = (TRACKING_MAP_HEIGHT / 2 - openCenter) / TRACKING_MAP_HEIGHT;
  return {
    ...region,
    latitude: region.latitude - southOfCenter * latitudeDelta,
    latitudeDelta,
  };
}

function latitudeDegrees(metres: number): number {
  return metres / METRES_PER_LATITUDE_DEGREE;
}

function longitudeDegrees(metres: number, latitude: number): number {
  const cosine = Math.cos((latitude * Math.PI) / 180);
  return metres / (METRES_PER_LATITUDE_DEGREE * Math.max(Math.abs(cosine), 0.01));
}
