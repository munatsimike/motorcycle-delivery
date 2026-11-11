export type NearbyRiderMapPoint = {
  latitude: number;
  longitude: number;
  expiresAt: string;
};

export type NearbyRiderMap = {
  count: number;
  points: NearbyRiderMapPoint[];
};

export function readNearbyRiderCount(value: unknown): number {
  if (!isRecord(value) || typeof value.count !== 'number' || !Number.isInteger(value.count) || value.count < 0) {
    throw new Error('Rider availability is unavailable.');
  }
  return value.count;
}

export function readNearbyRiderMap(value: unknown, now = new Date()): NearbyRiderMap {
  if (!isRecord(value)) {
    throw new Error('Rider availability is unavailable.');
  }
  const count = readNearbyRiderCount(value);
  const points = filterValidNearbyRiderPoints(Array.isArray(value.points) ? value.points.map(readNearbyRiderPoint) : [], now);
  // A point can expire while the response is in flight. Keep valid points.
  // Reject inconsistent payloads that claim fewer riders than valid points.
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

function readNearbyRiderPoint(value: unknown): NearbyRiderMapPoint {
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
