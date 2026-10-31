import { BadRequestException } from '@nestjs/common';

export const OUTSIDE_SERVICE_AREA = 'Riders currently supports deliveries within Zimbabwe.';

// Longitude, latitude. This is the Zimbabwe extent used for pickup, drop-off, and rider GPS.
// Keep the customer app copy in pickupLocation.ts aligned with these vertices.
const ZIMBABWE_EXTENT: ReadonlyArray<readonly [number, number]> = [
  [25.24, -17.78],
  [25.24, -19.30],
  [26.50, -21.20],
  [28.20, -22.40],
  [31.20, -22.42],
  [32.95, -21.60],
  [33.07, -18.20],
  [32.75, -16.05],
  [30.40, -15.61],
  [28.20, -15.70],
  [26.40, -17.10],
];

const NETHERLANDS_TEST_EXTENT = {
  minLatitude: 50.75,
  maxLatitude: 53.55,
  minLongitude: 3.2,
  maxLongitude: 7.23,
};

const HOSTED_ENV_KEYS = [
  'RENDER',
  'RENDER_SERVICE_ID',
  'FLY_APP_NAME',
  'DYNO',
  'K_SERVICE',
  'WEBSITE_SITE_NAME',
  'VERCEL',
  'VERCEL_ENV',
] as const;
const STAGE_ENV_KEYS = ['APP_ENV', 'DEPLOY_ENV', 'ENVIRONMENT', 'STAGE'] as const;
const LOCAL_BIND_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '::']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function netherlandsCoordinateBlockers(env: NodeJS.ProcessEnv = process.env): string[] {
  const blockers: string[] = [];
  if (env.ALLOW_TEST_NL_COORDINATES !== 'true') {
    blockers.push('ALLOW_TEST_NL_COORDINATES');
  }
  if (env.NODE_ENV !== 'development') {
    blockers.push('NODE_ENV');
  }
  for (const key of STAGE_ENV_KEYS) {
    const value = env[key]?.toLowerCase() ?? '';
    if (value === 'production' || value === 'staging') {
      blockers.push(key);
    }
  }
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('RAILWAY_') && value) {
      blockers.push(key);
    }
  }
  for (const key of HOSTED_ENV_KEYS) {
    if (env[key]) {
      blockers.push(key);
    }
  }
  if (env.TRUST_RAILWAY_EDGE_CLIENT_IP === 'true') {
    blockers.push('TRUST_RAILWAY_EDGE_CLIENT_IP');
  }
  const bindHost = env.HOST ?? env.BIND_HOST;
  if (bindHost && !LOCAL_BIND_HOSTS.has(bindHost)) {
    blockers.push('HOST');
  }
  for (const key of ['PUBLIC_URL', 'APP_URL', 'API_PUBLIC_URL'] as const) {
    const value = env[key];
    if (value && !isLoopbackUrl(value)) {
      blockers.push(key);
    }
  }
  return blockers;
}

export function netherlandsCoordinatesAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return netherlandsCoordinateBlockers(env).length === 0;
}

export function coordinateIsServable(
  latitude: number,
  longitude: number,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return false;
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return false;
  }
  if (pointInRing(longitude, latitude, ZIMBABWE_EXTENT)) {
    return true;
  }
  return netherlandsCoordinatesAllowed(env) && inBox(latitude, longitude, NETHERLANDS_TEST_EXTENT);
}

export function assertServiceCoordinates(
  latitude: string,
  longitude: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!coordinateIsServable(Number(latitude), Number(longitude), env)) {
    throw new BadRequestException(OUTSIDE_SERVICE_AREA);
  }
}

function inBox(
  latitude: number,
  longitude: number,
  box: { minLatitude: number; maxLatitude: number; minLongitude: number; maxLongitude: number },
): boolean {
  return latitude >= box.minLatitude
    && latitude <= box.maxLatitude
    && longitude >= box.minLongitude
    && longitude <= box.maxLongitude;
}

function pointInRing(longitude: number, latitude: number, ring: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    if (!currentPoint || !previousPoint) {
      continue;
    }
    const [currentLongitude, currentLatitude] = currentPoint;
    const [previousLongitude, previousLatitude] = previousPoint;
    const crossesLatitude = (currentLatitude > latitude) !== (previousLatitude > latitude);
    if (!crossesLatitude) {
      continue;
    }
    const edgeLongitude = ((previousLongitude - currentLongitude) * (latitude - currentLatitude))
      / (previousLatitude - currentLatitude)
      + currentLongitude;
    if (longitude < edgeLongitude) {
      inside = !inside;
    }
  }
  return inside;
}

function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}
