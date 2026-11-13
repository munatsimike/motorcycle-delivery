type MapPoint = {
  latitude: number;
  longitude: number;
};

export type NearbyMapFrame = MapPoint & {
  latitudeDelta: number;
  longitudeDelta: number;
};

/**
 * Smallest north-south span for the home camera.
 * 0.027° is about 3 km, a neighborhood rather than a single street.
 */
export const HOME_NEIGHBORHOOD_DELTA = 0.027;
/** Extra room so a marker is not placed on the exact edge of an expanded frame. */
const FRAME_PAD = 1.25;

/**
 * Frames the customer and the nearby points the API returned.
 * A close rider cannot shrink the span below the neighborhood minimum.
 * Returns null when there is no real point to center on.
 */
export function nearbyMapFrame(customer: MapPoint | null, riders: ReadonlyArray<MapPoint>): NearbyMapFrame | null {
  const points = customer ? [customer, ...riders] : [...riders];
  if (points.length === 0) {
    return null;
  }
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
  return {
    latitude: (minLatitude + maxLatitude) / 2,
    longitude: (minLongitude + maxLongitude) / 2,
    latitudeDelta: Math.max((maxLatitude - minLatitude) * FRAME_PAD, HOME_NEIGHBORHOOD_DELTA),
    longitudeDelta: Math.max((maxLongitude - minLongitude) * FRAME_PAD, HOME_NEIGHBORHOOD_DELTA),
  };
}

/**
 * Home background camera. Centers on the customer at the neighborhood span
 * and does not expand or shift for nearby riders.
 * Returns null when there is no real customer location.
 */
export function customerNeighborhoodFrame(customer: MapPoint | null): NearbyMapFrame | null {
  if (!customer) {
    return null;
  }
  return {
    latitude: customer.latitude,
    longitude: customer.longitude,
    latitudeDelta: HOME_NEIGHBORHOOD_DELTA,
    longitudeDelta: HOME_NEIGHBORHOOD_DELTA,
  };
}

/** True when every point sits inside the frame with room to spare for the marker. */
export function frameContainsPoints(frame: NearbyMapFrame, points: ReadonlyArray<MapPoint>): boolean {
  const latitudeLimit = (frame.latitudeDelta / 2) * 0.9;
  const longitudeLimit = (frame.longitudeDelta / 2) * 0.9;
  return points.every((point) =>
    Math.abs(point.latitude - frame.latitude) <= latitudeLimit
    && Math.abs(point.longitude - frame.longitude) <= longitudeLimit);
}
