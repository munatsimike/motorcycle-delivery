import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { loadBackendEnv } from '../load-env.js';

const logger = new Logger('Geoapify');

export type PlaceSuggestion = {
  label: string;
  latitude: number;
  longitude: number;
  exact: boolean;
};

export type RoadRoute = {
  metres: number;
  line: Array<[number, number]>;
};

const EXACT_RESULT_TYPES = new Set(['building', 'street']);
export const AUTOCOMPLETE_LIMIT = 10;
const HIDDEN_STREET_LABELS = [
  'highway-name-path',
  'highway-name-minor',
  'highway-name-major',
  'highway-shield',
  'highway-shield-us-interstate',
  'highway-shield-us-other',
].map((layer) => `${layer}:none`).join('|');

export function readPlaceSuggestions(body: unknown): PlaceSuggestion[] {
  const results = resultsOf(body);
  const suggestions: PlaceSuggestion[] = [];
  for (const result of results) {
    if (!isRecord(result)) {
      continue;
    }
    const label = typeof result.formatted === 'string' ? result.formatted.trim() : '';
    const latitude = finite(result.lat);
    const longitude = finite(result.lon);
    if (!label || latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      continue;
    }
    const resultType = typeof result.result_type === 'string' ? result.result_type : '';
    const houseNumber = typeof result.housenumber === 'string' ? result.housenumber.trim() : '';
    suggestions.push({
      label: suggestionLabel(result, label),
      latitude,
      longitude,
      exact: EXACT_RESULT_TYPES.has(resultType) || houseNumber.length > 0,
    });
    if (suggestions.length === AUTOCOMPLETE_LIMIT) {
      break;
    }
  }
  return suggestions;
}

export function readRoadRoute(body: unknown): RoadRoute | null {
  const features = isRecord(body) && Array.isArray(body.features) ? body.features : [];
  const feature = features.find(isRecord);
  if (!feature) {
    return null;
  }
  const properties = isRecord(feature.properties) ? feature.properties : null;
  const metres = properties ? finite(properties.distance) : null;
  const geometry = isRecord(feature.geometry) ? feature.geometry : null;
  const coordinates = geometry && Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  const line: Array<[number, number]> = [];
  for (const pair of coordinates) {
    if (!Array.isArray(pair) || pair.length < 2) {
      continue;
    }
    const longitude = finite(pair[0]);
    const latitude = finite(pair[1]);
    if (longitude === null || latitude === null) {
      continue;
    }
    line.push([longitude, latitude]);
  }
  if (metres === null || metres < 0 || !Number.isFinite(metres)) {
    return null;
  }
  return { metres, line };
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

  async autocomplete(
    text: string,
    bias?: { latitude: number; longitude: number } | null,
  ): Promise<PlaceSuggestion[]> {
    const url = autocompleteRequestUrl(text, this.key(), bias);
    const suggestions = readPlaceSuggestions(await this.getJson(url));
    logger.log(`Geoapify autocomplete results=${suggestions.length}`);
    return suggestions;
  }

  async route(pickupLatitude: number, pickupLongitude: number, dropoffLatitude: number, dropoffLongitude: number): Promise<RoadRoute> {
    const url = new URL('https://api.geoapify.com/v1/routing');
    url.searchParams.set('waypoints', `${pickupLatitude},${pickupLongitude}|${dropoffLatitude},${dropoffLongitude}`);
    url.searchParams.set('mode', 'drive');
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
    const sampled = sampleLine(line, 25);
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

export function autocompleteRequestUrl(
  text: string,
  apiKey: string,
  bias?: { latitude: number; longitude: number } | null,
): URL {
  const url = new URL('https://api.geoapify.com/v1/geocode/autocomplete');
  url.searchParams.set('text', text);
  url.searchParams.set('filter', 'countrycode:zw');
  url.searchParams.set('limit', String(AUTOCOMPLETE_LIMIT));
  url.searchParams.set('format', 'json');
  const latitude = bias ? finite(bias.latitude) : null;
  const longitude = bias ? finite(bias.longitude) : null;
  if (
    latitude !== null
    && longitude !== null
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180
  ) {
    url.searchParams.set('bias', `proximity:${longitude},${latitude}`);
  }
  url.searchParams.set('apiKey', apiKey);
  return url;
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

function sampleLine(line: Array<[number, number]>, maximum: number): Array<[number, number]> {
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

function suggestionLabel(result: Record<string, unknown>, formatted: string): string {
  const parts = addressParts(formatted);
  const area = suburbName(result);
  if (!area) {
    return parts.join(', ');
  }
  const city = text(result.city).toLowerCase();
  const withoutCity = city && parts.length > 1 && parts[parts.length - 1].toLowerCase() === city
    ? parts.slice(0, -1)
    : parts;
  if (withoutCity.some((part) => part.toLowerCase() === area.toLowerCase())) {
    return withoutCity.join(', ');
  }
  return [...withoutCity, area].join(', ');
}

function suburbName(result: Record<string, unknown>): string {
  const suburb = text(result.suburb);
  const city = text(result.city);
  if (!suburb || suburb.toLowerCase() === city.toLowerCase() || /^ward\b/i.test(suburb)) {
    return '';
  }
  return suburb;
}

function addressParts(label: string): string[] {
  const parts = label.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length > 1 && parts[parts.length - 1].toLowerCase() === 'zimbabwe') {
    parts.pop();
  }
  return parts;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resultsOf(body: unknown): unknown[] {
  if (!isRecord(body)) {
    return [];
  }
  if (Array.isArray(body.results)) {
    return body.results;
  }
  if (!Array.isArray(body.features)) {
    return [];
  }
  return body.features.map((feature) => {
    if (!isRecord(feature) || !isRecord(feature.properties)) {
      return null;
    }
    return feature.properties;
  });
}

function finite(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
