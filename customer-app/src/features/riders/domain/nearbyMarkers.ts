import { filterValidNearbyRiderPoints, isNearbyRiderPointExpired, type NearbyRiderMapPoint } from './nearbyRiderCount';

export type NearbyMarker = NearbyRiderMapPoint & {
  /** Session-only map key. Not a rider id and not stored. */
  id: string;
};

/** Same anonymous marker may move this far between polls before it is treated as a different point. */
export const NEARBY_MARKER_MATCH_METRES = 600;

export type NearbyMarkerUpdate =
  | { status: 'ready'; points: readonly NearbyRiderMapPoint[] }
  | { status: 'failed' };

/**
 * Keeps map keys stable across polls.
 * A failed refresh keeps unexpired markers. A successful response replaces them,
 * reusing a key only when the new approximate point is the same nearby position.
 */
export function nextNearbyMarkers(
  previous: readonly NearbyMarker[],
  update: NearbyMarkerUpdate,
  createId: () => string,
  now = new Date(),
): readonly NearbyMarker[] {
  if (update.status === 'failed') {
    const visible = previous.filter((point) => !isNearbyRiderPointExpired(point, now));
    return visible.length === previous.length ? previous : visible;
  }
  return matchNearbyMarkers(previous, filterValidNearbyRiderPoints([...update.points], now), createId);
}

function matchNearbyMarkers(
  previous: readonly NearbyMarker[],
  next: readonly NearbyRiderMapPoint[],
  createId: () => string,
): NearbyMarker[] {
  const pairs: Array<{ previousIndex: number; nextIndex: number; distance: number }> = [];
  previous.forEach((marker, previousIndex) => {
    next.forEach((point, nextIndex) => {
      const distance = distanceMetres(marker, point);
      if (distance <= NEARBY_MARKER_MATCH_METRES) {
        pairs.push({ previousIndex, nextIndex, distance });
      }
    });
  });
  pairs.sort((left, right) => left.distance - right.distance || left.previousIndex - right.previousIndex || left.nextIndex - right.nextIndex);
  const usedPrevious = new Set<number>();
  const assigned = new Array<string | undefined>(next.length);
  for (const pair of pairs) {
    if (usedPrevious.has(pair.previousIndex) || assigned[pair.nextIndex] !== undefined) continue;
    usedPrevious.add(pair.previousIndex);
    assigned[pair.nextIndex] = previous[pair.previousIndex].id;
  }
  return next.map((point, index) => ({
    latitude: point.latitude,
    longitude: point.longitude,
    expiresAt: point.expiresAt,
    id: assigned[index] ?? createId(),
  }));
}

function distanceMetres(left: NearbyRiderMapPoint, right: NearbyRiderMapPoint): number {
  const earthMetres = 6_371_000;
  const latitudeDelta = toRadians(right.latitude - left.latitude);
  const longitudeDelta = toRadians(right.longitude - left.longitude);
  const leftLatitude = toRadians(left.latitude);
  const rightLatitude = toRadians(right.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthMetres * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function toRadians(degrees: number): number {
  return degrees * Math.PI / 180;
}
