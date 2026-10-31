import { createGeoapifyClient, sampleRoadLine, type RoadRoute } from './geoapify.js';

export const PICKUP_APPROACH = Symbol('PICKUP_APPROACH');
export const PICKUP_APPROACH_CELL = 0.0015;
export const PICKUP_APPROACH_MAX_AGE_MS = 3 * 60 * 1000;
export const PICKUP_APPROACH_FAILURE_MS = 30 * 1000;
export const PICKUP_APPROACH_LINE_LIMIT = 40;
const CACHE_LIMIT = 100;

export type PickupApproachView = {
  metres: number;
  seconds: number;
  line: Array<{ latitude: number; longitude: number }>;
};

export type PickupApproachQuery = {
  riderProfileId: string;
  riderLatitude: number;
  riderLongitude: number;
  pickupLatitude: number;
  pickupLongitude: number;
};

export type PickupApproachLookup = {
  lookup(query: PickupApproachQuery): Promise<PickupApproachView | null>;
};

type CacheEntry = {
  approach: PickupApproachView | null;
  at: number;
};

export function approachCell(value: number): number {
  return Math.round(value / PICKUP_APPROACH_CELL) * PICKUP_APPROACH_CELL;
}

export function pickupApproachKey(query: PickupApproachQuery): string {
  return [
    query.riderProfileId,
    approachCell(query.riderLatitude).toFixed(4),
    approachCell(query.riderLongitude).toFixed(4),
    query.pickupLatitude.toFixed(5),
    query.pickupLongitude.toFixed(5),
  ].join('|');
}

export function createPickupApproachCache(
  route: (
    fromLatitude: number,
    fromLongitude: number,
    toLatitude: number,
    toLongitude: number,
  ) => Promise<RoadRoute>,
  now: () => number = Date.now,
): PickupApproachLookup {
  const cache = new Map<string, CacheEntry>();
  return {
    async lookup(query) {
      if (!usableQuery(query)) {
        return null;
      }
      const key = pickupApproachKey(query);
      const saved = cache.get(key);
      const maxAge = saved?.approach ? PICKUP_APPROACH_MAX_AGE_MS : PICKUP_APPROACH_FAILURE_MS;
      if (saved && now() - saved.at < maxAge) {
        return saved.approach;
      }
      try {
        const road = await route(
          query.riderLatitude,
          query.riderLongitude,
          query.pickupLatitude,
          query.pickupLongitude,
        );
        const approach = toApproach(road);
        remember(cache, key, approach, now());
        return approach;
      } catch {
        remember(cache, key, null, now());
        return null;
      }
    },
  };
}

export function createGeoapifyPickupApproach(): PickupApproachLookup {
  const client = createGeoapifyClient();
  return createPickupApproachCache((fromLatitude, fromLongitude, toLatitude, toLongitude) => (
    client.route(fromLatitude, fromLongitude, toLatitude, toLongitude)
  ));
}

function usableQuery(query: PickupApproachQuery): boolean {
  return query.riderProfileId.trim().length > 0 && [
    query.riderLatitude,
    query.riderLongitude,
    query.pickupLatitude,
    query.pickupLongitude,
  ].every((value) => Number.isFinite(value));
}

function toApproach(road: RoadRoute): PickupApproachView | null {
  if (!Number.isFinite(road.metres) || road.metres < 0 || road.seconds == null || road.seconds < 0) {
    return null;
  }
  const line = sampleRoadLine(road.line, PICKUP_APPROACH_LINE_LIMIT).flatMap(([longitude, latitude]) => (
    Number.isFinite(latitude) && Number.isFinite(longitude) ? [{ latitude, longitude }] : []
  ));
  return {
    metres: road.metres,
    seconds: Math.round(road.seconds),
    line,
  };
}

function remember(cache: Map<string, CacheEntry>, key: string, approach: PickupApproachView | null, at: number) {
  cache.delete(key);
  cache.set(key, { approach, at });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (!oldest) {
      return;
    }
    cache.delete(oldest);
  }
}
