import { Logger } from '@nestjs/common';
import { createGeoapifyClient, sampleRoadLine, type RoadRoute, type RouteManeuver } from './geoapify.js';

const logger = new Logger('PickupApproach');
const METRES_PER_DEGREE = 111_320;
export const OFF_ROUTE_PRECISE_METRES = 25;
export const OFF_ROUTE_METRES = 45;
export const OFF_ROUTE_LOOSE_METRES = 80;
export const OFF_ROUTE_PRECISE_ACCURACY_METRES = 15;
export const OFF_ROUTE_ACCURACY_METRES = 40;

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
  path?: Array<{ latitude: number; longitude: number }>;
  steps?: RouteManeuver[];
};

export type PickupApproachQuery = {
  riderProfileId: string;
  riderLatitude: number;
  riderLongitude: number;
  pickupLatitude: number;
  pickupLongitude: number;
  accuracyMetres?: number | null;
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
  const inflight = new Map<string, Promise<PickupApproachView | null>>();
  return {
    async lookup(query) {
      if (!usableQuery(query)) {
        return null;
      }
      const key = pickupApproachKey(query);
      const cached = cachedApproach(cache, key, now());
      if (cached !== undefined && !outsideCachedCorridor(query, cached)) {
        return cached;
      }
      const pending = inflight.get(key);
      if (pending && cached === undefined) {
        return pending;
      }
      const work = loadApproach(route, cache, query, now);
      inflight.set(key, work);
      try {
        return await work;
      } finally {
        inflight.delete(key);
      }
    },
  };
}

function cachedApproach(
  cache: Map<string, CacheEntry>,
  key: string,
  at: number,
): PickupApproachView | null | undefined {
  const saved = cache.get(key);
  if (!saved) {
    return undefined;
  }
  const maxAge = saved.approach ? PICKUP_APPROACH_MAX_AGE_MS : PICKUP_APPROACH_FAILURE_MS;
  if (at - saved.at >= maxAge) {
    return undefined;
  }
  return saved.approach;
}

async function loadApproach(
  route: (
    fromLatitude: number,
    fromLongitude: number,
    toLatitude: number,
    toLongitude: number,
  ) => Promise<RoadRoute>,
  cache: Map<string, CacheEntry>,
  query: PickupApproachQuery,
  now: () => number,
): Promise<PickupApproachView | null> {
  try {
    const road = await route(
      query.riderLatitude,
      query.riderLongitude,
      query.pickupLatitude,
      query.pickupLongitude,
    );
    const approach = toApproach(road);
    remember(cache, pickupApproachKey(query), approach, now());
    return approach;
  } catch {
    remember(cache, pickupApproachKey(query), null, now());
    return null;
  }
}

export function createGeoapifyPickupApproach(): PickupApproachLookup {
  const client = createGeoapifyClient();
  return createPickupApproachCache((fromLatitude, fromLongitude, toLatitude, toLongitude) => (
    client.route(fromLatitude, fromLongitude, toLatitude, toLongitude)
  ));
}

export function offRouteCorridorMetres(accuracyMetres: number | null | undefined): number {
  if (typeof accuracyMetres === 'number' && Number.isFinite(accuracyMetres) &&
    accuracyMetres > 0 && accuracyMetres <= OFF_ROUTE_PRECISE_ACCURACY_METRES) {
    return OFF_ROUTE_PRECISE_METRES;
  }
  if (accuracyMetres == null || !Number.isFinite(accuracyMetres) || accuracyMetres > OFF_ROUTE_ACCURACY_METRES) {
    return OFF_ROUTE_LOOSE_METRES;
  }
  return OFF_ROUTE_METRES;
}

function outsideCachedCorridor(query: PickupApproachQuery, approach: PickupApproachView | null): boolean {
  if (!approach) {
    return false;
  }
  const line = approach.path && approach.path.length > 1 ? approach.path : approach.line;
  if (line.length < 2) {
    return false;
  }
  const distance = distanceToPathMetres(query.riderLatitude, query.riderLongitude, line);
  const corridor = offRouteCorridorMetres(query.accuracyMetres);
  if (distance <= corridor) {
    return false;
  }
  logger.debug(
    `pickup route cache bypassed distanceM=${Math.round(distance)} corridorM=${corridor} accuracyM=${
      query.accuracyMetres ?? '-'
    }`,
  );
  return true;
}

function distanceToPathMetres(
  latitude: number,
  longitude: number,
  path: Array<{ latitude: number; longitude: number }>,
): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < path.length - 1; index += 1) {
    const distance = distanceToSegmentMetres(latitude, longitude, path[index], path[index + 1]);
    if (distance < best) {
      best = distance;
    }
  }
  return best;
}

function distanceToSegmentMetres(
  latitude: number,
  longitude: number,
  start: { latitude: number; longitude: number },
  end: { latitude: number; longitude: number },
): number {
  const endLocal = localMetres(end.latitude, end.longitude, start.latitude, start.longitude);
  const point = localMetres(latitude, longitude, start.latitude, start.longitude);
  const lengthSquared = endLocal.north * endLocal.north + endLocal.east * endLocal.east;
  const fraction = lengthSquared < 0.25
    ? 0
    : Math.min(1, Math.max(0, (point.north * endLocal.north + point.east * endLocal.east) / lengthSquared));
  return Math.hypot(point.north - endLocal.north * fraction, point.east - endLocal.east * fraction);
}

function localMetres(latitude: number, longitude: number, originLatitude: number, originLongitude: number) {
  return {
    north: (latitude - originLatitude) * METRES_PER_DEGREE,
    east: (longitude - originLongitude) * METRES_PER_DEGREE * Math.cos((originLatitude * Math.PI) / 180),
  };
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
  const path = roadPoints(road.line);
  const line = roadPoints(sampleRoadLine(road.line, PICKUP_APPROACH_LINE_LIMIT));
  return {
    metres: road.metres,
    seconds: Math.round(road.seconds),
    line,
    path,
    steps: road.steps,
  };
}

function roadPoints(line: Array<[number, number]>): Array<{ latitude: number; longitude: number }> {
  return line.flatMap(([longitude, latitude]) => (
    Number.isFinite(latitude) && Number.isFinite(longitude) ? [{ latitude, longitude }] : []
  ));
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
