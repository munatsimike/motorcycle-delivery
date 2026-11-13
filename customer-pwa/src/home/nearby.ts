export type NearbyRiderMapPoint = {
  latitude: number;
  longitude: number;
  expiresAt: string;
};

export type NearbyMarker = NearbyRiderMapPoint & {
  id: string;
};

export type NearbyAvailability =
  | { status: 'loading' }
  | { status: 'services-off' }
  | { status: 'permission-denied'; canAskAgain: boolean }
  | { status: 'position-unavailable' }
  | { status: 'ready'; count: number }
  | { status: 'check-failed'; message: string };

export type DeviceLocation =
  | { status: 'services-off' }
  | { status: 'permission-denied'; canAskAgain: boolean }
  | { status: 'position-unavailable' }
  | { status: 'ready'; latitude: number; longitude: number };

const NEARBY_MARKER_MATCH_METRES = 600;

export function readNearbyRiderMap(value: unknown, now = new Date()): { count: number; points: NearbyRiderMapPoint[] } {
  if (!isRecord(value)) {
    throw new Error('Rider availability is unavailable.');
  }
  const count = readCount(value);
  const points = filterValidNearbyRiderPoints(Array.isArray(value.points) ? value.points.map(readPoint) : [], now);
  if (points.length > count) {
    throw new Error('Rider availability is unavailable.');
  }
  return { count: points.length, points };
}

export function filterValidNearbyRiderPoints(points: NearbyRiderMapPoint[], now = new Date()): NearbyRiderMapPoint[] {
  return points.filter((point) => !isNearbyRiderPointExpired(point, now));
}

export function isNearbyRiderPointExpired(point: NearbyRiderMapPoint, now = new Date()): boolean {
  const expiresAtMs = Date.parse(point.expiresAt);
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime();
}

export function coordinateQuery(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error('Enter a valid location');
  }
  return value.toFixed(6);
}

export function nearbyHomeCountLabel(state: NearbyAvailability): string {
  if (state.status === 'loading') return 'Checking';
  if (state.status === 'services-off') return 'Location is off';
  if (state.status === 'permission-denied') return 'Location needed';
  if (state.status === 'position-unavailable') return 'Location unavailable';
  if (state.status === 'check-failed') return 'Unable to check';
  const riders = state.count === 1 ? 'rider' : 'riders';
  return `${state.count} ${riders} nearby`;
}

export function locationFromGeolocationError(error: { code: number; message?: string }): Exclude<DeviceLocation, { status: 'ready' }> {
  if (error.code === 1) {
    return { status: 'permission-denied', canAskAgain: false };
  }
  if (error.code === 2 && /disabled|turned off|location service/i.test(error.message ?? '')) {
    return { status: 'services-off' };
  }
  return { status: 'position-unavailable' };
}

export function nextNearbyMarkers(
  previous: readonly NearbyMarker[],
  update: { status: 'ready'; points: readonly NearbyRiderMapPoint[] } | { status: 'failed' },
  createId: () => string,
  now = new Date(),
): NearbyMarker[] {
  if (update.status === 'failed') {
    return previous.filter((point) => !isNearbyRiderPointExpired(point, now));
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

function readCount(value: Record<string, unknown>): number {
  if (typeof value.count !== 'number' || !Number.isInteger(value.count) || value.count < 0) {
    throw new Error('Rider availability is unavailable.');
  }
  return value.count;
}

function readPoint(value: unknown): NearbyRiderMapPoint {
  if (!isRecord(value) || !Number.isFinite(value.latitude) || !Number.isFinite(value.longitude) || Number(value.latitude) < -90 || Number(value.latitude) > 90 || Number(value.longitude) < -180 || Number(value.longitude) > 180 || typeof value.expiresAt !== 'string') {
    throw new Error('Rider availability is unavailable.');
  }
  return {
    latitude: Number(value.latitude),
    longitude: Number(value.longitude),
    expiresAt: value.expiresAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
