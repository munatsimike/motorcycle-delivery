export type NearbyRiderMapPoint = {
  id: string;
  latitude: number;
  longitude: number;
  expiresAt: string;
};

export type NearbyMarker = NearbyRiderMapPoint;

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

export const NEARBY_MARKER_PRUNE_MS = 5_000;

export function readNearbyRiderMap(value: unknown, now = new Date()): { count: number; points: NearbyRiderMapPoint[] } {
  if (!isRecord(value)) {
    throw new Error('Rider availability is unavailable.');
  }
  const count = readCount(value);
  const rawPoints = Array.isArray(value.points) ? value.points : [];
  const points = filterValidNearbyRiderPoints(rawPoints.flatMap((item) => {
    const point = readPoint(item);
    return point ? [point] : [];
  }), now);
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
  now = new Date(),
): NearbyMarker[] {
  if (update.status === 'failed') {
    return previous.filter((point) => !isNearbyRiderPointExpired(point, now));
  }
  return markersByRider(filterValidNearbyRiderPoints([...update.points], now));
}

function markersByRider(points: readonly NearbyRiderMapPoint[]): NearbyMarker[] {
  const markers = new Map<string, NearbyMarker>();
  for (const point of points) {
    markers.set(point.id, point);
  }
  return [...markers.values()];
}

function readCount(value: Record<string, unknown>): number {
  if (typeof value.count !== 'number' || !Number.isInteger(value.count) || value.count < 0) {
    throw new Error('Rider availability is unavailable.');
  }
  return value.count;
}

function readPoint(value: unknown): NearbyRiderMapPoint | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.id) || !Number.isFinite(value.latitude) || !Number.isFinite(value.longitude) || Number(value.latitude) < -90 || Number(value.latitude) > 90 || Number(value.longitude) < -180 || Number(value.longitude) > 180 || typeof value.expiresAt !== 'string') {
    return null;
  }
  return {
    id: value.id,
    latitude: Number(value.latitude),
    longitude: Number(value.longitude),
    expiresAt: value.expiresAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
