import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { loadBackendEnv } from '../load-env.js';

const logger = new Logger('Geoapify');

export type RouteManeuver = {
  text: string;
  type: string;
  streets: string[];
  metres: number;
  seconds: number;
  fromIndex: number;
  toIndex: number;
  latitude: number;
  longitude: number;
};

export type RoadRoute = {
  metres: number;
  seconds: number | null;
  line: Array<[number, number]>;
  steps: RouteManeuver[];
};

const HIDDEN_STREET_LABELS = [
  'highway-name-path',
  'highway-name-minor',
  'highway-name-major',
  'highway-shield',
  'highway-shield-us-interstate',
  'highway-shield-us-other',
].map((layer) => `${layer}:none`).join('|');

export function readRoadRoute(body: unknown): RoadRoute | null {
  const features = isRecord(body) && Array.isArray(body.features) ? body.features : [];
  const feature = features.find(isRecord);
  if (!feature) {
    return null;
  }
  const properties = isRecord(feature.properties) ? feature.properties : null;
  const metres = properties ? finite(properties.distance) : null;
  const seconds = properties ? finite(properties.time) : null;
  const geometry = isRecord(feature.geometry) ? feature.geometry : null;
  const coordinates = geometry && Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  const line: Array<[number, number]> = [];
  collectPositions(coordinates, line);
  if (metres === null || metres < 0 || !Number.isFinite(metres)) {
    return null;
  }
  return {
    metres,
    seconds: seconds !== null && seconds >= 0 ? seconds : null,
    line,
    steps: readManeuvers(properties, line),
  };
}

export function encodePolyline(line: Array<[number, number]>): string {
  let encoded = '';
  let previousLatitude = 0;
  let previousLongitude = 0;
  for (const [longitude, latitude] of line) {
    encoded += encodeSigned(Math.round(latitude * 1e5) - previousLatitude);
    encoded += encodeSigned(Math.round(longitude * 1e5) - previousLongitude);
    previousLatitude = Math.round(latitude * 1e5);
    previousLongitude = Math.round(longitude * 1e5);
  }
  return encoded;
}

export class GeoapifyRequestError extends Error {
  constructor(readonly status: number) {
    super('Geoapify request failed');
    this.name = 'GeoapifyRequestError';
  }
}

export class GeoapifyClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async route(pickupLatitude: number, pickupLongitude: number, dropoffLatitude: number, dropoffLongitude: number): Promise<RoadRoute> {
    const url = new URL('https://api.geoapify.com/v1/routing');
    url.searchParams.set('waypoints', `${pickupLatitude},${pickupLongitude}|${dropoffLatitude},${dropoffLongitude}`);
    url.searchParams.set('mode', 'drive');
    url.searchParams.set('details', 'instruction_details');
    url.searchParams.set('apiKey', this.key());
    const route = readRoadRoute(await this.getJson(url));
    if (!route) {
      throw new Error('Geoapify route missing');
    }
    return route;
  }

  async staticMap(
    pickupLatitude: number,
    pickupLongitude: number,
    dropoffLatitude: number,
    dropoffLongitude: number,
    line: Array<[number, number]>,
  ): Promise<Uint8Array> {
    const url = new URL('https://maps.geoapify.com/v1/staticmap');
    url.searchParams.set('style', 'osm-bright');
    url.searchParams.set('styleCustomization', HIDDEN_STREET_LABELS);
    url.searchParams.set('width', '640');
    url.searchParams.set('height', '360');
    url.searchParams.append('marker', `lonlat:${pickupLongitude},${pickupLatitude};color:#169b62;size:medium`);
    url.searchParams.append('marker', `lonlat:${dropoffLongitude},${dropoffLatitude};color:#087a4a;size:medium`);
    url.searchParams.set('apiKey', this.key());
    const sampled = sampleRoadLine(line, 25);
    const geometry = sampled.length > 1 ? `polyline:${encodePolyline(sampled)}` : '';
    if (geometry && geometry.length < 1800) {
      const withRoute = new URL(url);
      withRoute.searchParams.set('geometry', geometry);
      try {
        return await this.readBytes(withRoute);
      } catch (error) {
        if (error instanceof ServiceUnavailableException) {
          throw error;
        }
      }
    }
    return this.readBytes(url);
  }

  async pointMap(latitude: number, longitude: number): Promise<Uint8Array> {
    const url = new URL('https://maps.geoapify.com/v1/staticmap');
    url.searchParams.set('style', 'osm-bright');
    url.searchParams.set('width', '640');
    url.searchParams.set('height', '320');
    url.searchParams.set('center', `lonlat:${longitude},${latitude}`);
    url.searchParams.set('zoom', '16');
    url.searchParams.set('marker', `lonlat:${longitude},${latitude};color:#169b62;size:medium`);
    url.searchParams.set('apiKey', this.key());
    return this.readBytes(url);
  }

  private key(): string {
    const key = (this.apiKey || process.env.GEOAPIFY_API_KEY || '').trim();
    if (!key) {
      logger.warn('Geoapify API key is not configured');
      throw new ServiceUnavailableException('Location lookup is unavailable.');
    }
    return key;
  }

  private async getJson(url: URL): Promise<unknown> {
    const response = await this.request(url);
    return response.json() as Promise<unknown>;
  }

  private async readBytes(url: URL): Promise<Uint8Array> {
    const response = await this.request(url);
    return new Uint8Array(await response.arrayBuffer());
  }

  private async request(url: URL): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'Error';
      logger.warn(`Geoapify request failed reason=${reason}`);
      throw new GeoapifyRequestError(0);
    }
    if (!response.ok) {
      logger.warn(`Geoapify request failed status=${response.status}`);
      throw new GeoapifyRequestError(response.status);
    }
    return response;
  }
}

export function createGeoapifyClient(): GeoapifyClient {
  loadBackendEnv();
  return new GeoapifyClient(process.env.GEOAPIFY_API_KEY ?? '');
}

export type RoadDistance = {
  metres(
    pickupLatitude: number,
    pickupLongitude: number,
    dropoffLatitude: number,
    dropoffLongitude: number,
  ): Promise<number>;
};

export const ROAD_DISTANCE = Symbol('ROAD_DISTANCE');

const ROAD_CACHE_LIMIT = 100;
const ROAD_CACHE_MS = 10 * 60 * 1000;

export function geoapifyRoadDistance(): RoadDistance {
  const client = createGeoapifyClient();
  const cache = new Map<string, { metres: number; at: number }>();
  return {
    async metres(pickupLatitude, pickupLongitude, dropoffLatitude, dropoffLongitude) {
      const key = [pickupLatitude, pickupLongitude, dropoffLatitude, dropoffLongitude]
        .map((value) => value.toFixed(7))
        .join(',');
      const saved = cache.get(key);
      if (saved && Date.now() - saved.at < ROAD_CACHE_MS) {
        return saved.metres;
      }
      const metres = (await client.route(pickupLatitude, pickupLongitude, dropoffLatitude, dropoffLongitude)).metres;
      cache.set(key, { metres, at: Date.now() });
      if (cache.size > ROAD_CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest) {
          cache.delete(oldest);
        }
      }
      return metres;
    },
  };
}

export function sampleRoadLine(line: Array<[number, number]>, maximum: number): Array<[number, number]> {
  if (line.length <= maximum) {
    return line;
  }
  const sampled: Array<[number, number]> = [];
  const step = (line.length - 1) / (maximum - 1);
  for (let index = 0; index < maximum; index += 1) {
    sampled.push(line[Math.round(index * step)] ?? line[line.length - 1]);
  }
  return sampled;
}

function encodeSigned(value: number): string {
  let shifted = value < 0 ? ~(value << 1) : value << 1;
  let encoded = '';
  while (shifted >= 0x20) {
    encoded += String.fromCharCode((0x20 | (shifted & 0x1f)) + 63);
    shifted >>= 5;
  }
  encoded += String.fromCharCode(shifted + 63);
  return encoded;
}

function collectPositions(value: unknown, line: Array<[number, number]>) {
  if (!Array.isArray(value)) {
    return;
  }
  const longitude = finite(value[0]);
  const latitude = finite(value[1]);
  if (longitude !== null && latitude !== null) {
    line.push([longitude, latitude]);
    return;
  }
  for (const child of value) {
    collectPositions(child, line);
  }
}

function readManeuvers(properties: Record<string, unknown> | null, line: Array<[number, number]>): RouteManeuver[] {
  if (!properties || !Array.isArray(properties.legs)) {
    return [];
  }
  const steps: RouteManeuver[] = [];
  for (const leg of properties.legs) {
    if (!isRecord(leg) || !Array.isArray(leg.steps)) {
      continue;
    }
    for (const step of leg.steps) {
      const maneuver = readManeuver(step, line);
      if (maneuver) {
        steps.push(maneuver);
      }
    }
  }
  return steps;
}

function readManeuver(step: unknown, line: Array<[number, number]>): RouteManeuver | null {
  if (!isRecord(step) || !isRecord(step.instruction)) {
    return null;
  }
  const text = typeof step.instruction.text === 'string' ? step.instruction.text.trim() : '';
  if (!text) {
    return null;
  }
  const type = typeof step.instruction.type === 'string' && step.instruction.type.trim()
    ? step.instruction.type.trim()
    : 'None';
  const streets = Array.isArray(step.instruction.streets)
    ? step.instruction.streets.flatMap((street) => (
      typeof street === 'string' && street.trim() ? [street.trim()] : []
    ))
    : [];
  const fromIndex = coordinateIndex(step.from_index, line.length);
  if (fromIndex === null) {
    return null;
  }
  const point = line[fromIndex];
  const toIndex = coordinateIndex(step.to_index, line.length);
  const metres = finite(step.distance);
  const seconds = finite(step.time);
  if (!point || metres === null || metres < 0) {
    return null;
  }
  return {
    text,
    type,
    streets,
    metres,
    seconds: seconds !== null && seconds >= 0 ? seconds : 0,
    fromIndex,
    toIndex: toIndex !== null && toIndex >= fromIndex ? toIndex : fromIndex,
    longitude: point[0],
    latitude: point[1],
  };
}

function coordinateIndex(value: unknown, length: number): number | null {
  const numeric = finite(value);
  if (numeric === null) {
    return null;
  }
  const index = Math.round(numeric);
  return index >= 0 && index < length ? index : null;
}

function finite(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
