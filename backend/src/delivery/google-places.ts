import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { loadBackendEnv } from '../load-env.js';

const logger = new Logger('GooglePlaces');

const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const DETAILS_URL = 'https://places.googleapis.com/v1/places/';
const AUTOCOMPLETE_FIELDS = [
  'suggestions.placePrediction.placeId',
  'suggestions.placePrediction.text.text',
  'suggestions.placePrediction.types',
].join(',');
const DETAILS_FIELDS = 'id,formattedAddress,location,addressComponents';
const LOCATION_FIELDS = 'location';
const BIAS_RADIUS_METRES = 50_000;
const SESSION_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLACE_ID = /^[A-Za-z0-9_-]{8,255}$/;
const EXACT_TYPES = new Set(['street_address', 'premise', 'subpremise', 'route', 'street_number']);

export type PlaceSuggestion = {
  label: string;
  placeId: string;
  exact: boolean;
};

export type ResolvedPlace = {
  label: string;
  latitude: number;
  longitude: number;
  suburb?: string;
  locality?: string;
};

export class GooglePlacesRequestError extends Error {
  constructor(readonly status: number) {
    super('Google Places request failed');
    this.name = 'GooglePlacesRequestError';
  }
}

export function isSessionToken(value: string): boolean {
  return SESSION_TOKEN.test(value);
}

export function isPlaceId(value: string): boolean {
  return PLACE_ID.test(value);
}

export function autocompleteBody(
  text: string,
  sessionToken: string,
  bias?: { latitude: number; longitude: number } | null,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    input: text,
    includedRegionCodes: ['zw'],
    languageCode: 'en',
    sessionToken,
  };
  if (
    bias
    && Number.isFinite(bias.latitude)
    && Number.isFinite(bias.longitude)
    && bias.latitude >= -90
    && bias.latitude <= 90
    && bias.longitude >= -180
    && bias.longitude <= 180
  ) {
    body.locationBias = {
      circle: {
        center: { latitude: bias.latitude, longitude: bias.longitude },
        radius: BIAS_RADIUS_METRES,
      },
    };
  }
  return body;
}

export function readAutocompleteSuggestions(body: unknown): PlaceSuggestion[] {
  if (!isRecord(body) || !Array.isArray(body.suggestions)) {
    return [];
  }
  const suggestions: PlaceSuggestion[] = [];
  for (const item of body.suggestions) {
    if (!isRecord(item) || !isRecord(item.placePrediction)) {
      continue;
    }
    const prediction = item.placePrediction;
    const placeId = typeof prediction.placeId === 'string' ? prediction.placeId.trim() : '';
    const text = isRecord(prediction.text) && typeof prediction.text.text === 'string'
      ? prediction.text.text.trim()
      : '';
    if (!isPlaceId(placeId) || !text) {
      continue;
    }
    const types = Array.isArray(prediction.types)
      ? prediction.types.filter((type): type is string => typeof type === 'string')
      : [];
    suggestions.push({
      label: withoutCountry(text),
      placeId,
      exact: types.some((type) => EXACT_TYPES.has(type)),
    });
  }
  return suggestions;
}

export function readResolvedPlace(body: unknown): ResolvedPlace | null {
  if (!isRecord(body)) {
    return null;
  }
  const parts = readAddressParts(body.addressComponents);
  const formatted = typeof body.formattedAddress === 'string' ? withoutCountry(body.formattedAddress.trim()) : '';
  const label = streetLabel(parts) || formatted;
  const location = isRecord(body.location) ? body.location : null;
  const latitude = location ? finite(location.latitude) : null;
  const longitude = location ? finite(location.longitude) : null;
  if (!label || latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }
  return {
    label,
    latitude,
    longitude,
    ...(parts.suburb ? { suburb: parts.suburb } : {}),
    ...(parts.locality ? { locality: parts.locality } : {}),
  };
}

export function readPlaceLocation(body: unknown): { latitude: number; longitude: number } | null {
  if (!isRecord(body) || !isRecord(body.location)) {
    return null;
  }
  const latitude = finite(body.location.latitude);
  const longitude = finite(body.location.longitude);
  if (latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }
  return { latitude, longitude };
}

export class GooglePlacesClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async autocomplete(
    text: string,
    sessionToken: string,
    bias?: { latitude: number; longitude: number } | null,
  ): Promise<PlaceSuggestion[]> {
    const response = await this.request(AUTOCOMPLETE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.key(),
        'X-Goog-FieldMask': AUTOCOMPLETE_FIELDS,
      },
      body: JSON.stringify(autocompleteBody(text, sessionToken, bias)),
    });
    const suggestions = readAutocompleteSuggestions(await response.json());
    logger.log(`Google Places autocomplete results=${suggestions.length}`);
    return suggestions;
  }

  async details(placeId: string, sessionToken: string): Promise<ResolvedPlace> {
    const url = new URL(`${DETAILS_URL}${encodeURIComponent(placeId)}`);
    url.searchParams.set('sessionToken', sessionToken);
    const response = await this.request(url, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': this.key(),
        'X-Goog-FieldMask': DETAILS_FIELDS,
      },
    });
    const place = readResolvedPlace(await response.json());
    if (!place) {
      throw new GooglePlacesRequestError(502);
    }
    return place;
  }

  async location(placeId: string): Promise<{ latitude: number; longitude: number }> {
    if (!isPlaceId(placeId)) {
      throw new GooglePlacesRequestError(400);
    }
    const url = new URL(`${DETAILS_URL}${encodeURIComponent(placeId)}`);
    const response = await this.request(url, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
        'X-Goog-Api-Key': this.key(),
        'X-Goog-FieldMask': LOCATION_FIELDS,
      },
    });
    const point = readPlaceLocation(await response.json());
    if (!point) {
      throw new GooglePlacesRequestError(502);
    }
    logger.log('Google Places location refresh completed');
    return point;
  }

  private key(): string {
    const key = (this.apiKey || process.env.GOOGLE_MAPS_API_KEY || '').trim();
    if (!key) {
      logger.warn('Google Maps API key is not configured');
      throw new ServiceUnavailableException('Address search is unavailable.');
    }
    return key;
  }

  private async request(url: string | URL, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(10_000) });
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'Error';
      logger.warn(`Google Places request failed reason=${reason}`);
      throw new GooglePlacesRequestError(0);
    }
    if (!response.ok) {
      logger.warn(`Google Places request failed status=${response.status}`);
      throw new GooglePlacesRequestError(response.status);
    }
    return response;
  }
}

export function createGooglePlacesClient(): GooglePlacesClient {
  loadBackendEnv();
  return new GooglePlacesClient(process.env.GOOGLE_MAPS_API_KEY ?? '');
}

function readAddressParts(components: unknown): { suburb: string; locality: string; street: string } {
  const streetNumber = componentText(components, 'street_number');
  const route = componentText(components, 'route');
  const suburb = componentText(components, 'sublocality_level_1')
    || componentText(components, 'neighborhood')
    || componentText(components, 'sublocality');
  return {
    suburb,
    locality: componentText(components, 'locality'),
    street: [streetNumber, route].filter((part) => part.length > 0).join(' '),
  };
}

function streetLabel(parts: { suburb: string; locality: string; street: string }): string {
  const street = parts.street.trim();
  const suburb = parts.suburb.trim();
  const locality = parts.locality.trim();
  const area = suburb || locality;
  if (street && area && area.toLowerCase() !== street.toLowerCase()) {
    return `${street}, ${area}`;
  }
  return street || area;
}

function componentText(components: unknown, type: string): string {
  if (!Array.isArray(components)) {
    return '';
  }
  for (const component of components) {
    if (!isRecord(component) || !Array.isArray(component.types) || !component.types.includes(type)) {
      continue;
    }
    const text = typeof component.longText === 'string'
      ? component.longText.trim()
      : typeof component.shortText === 'string'
        ? component.shortText.trim()
        : '';
    if (text) {
      return text;
    }
  }
  return '';
}

function withoutCountry(label: string): string {
  const parts = label.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length > 1 && parts[parts.length - 1].toLowerCase() === 'zimbabwe') {
    parts.pop();
  }
  return parts.join(', ');
}

function finite(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
