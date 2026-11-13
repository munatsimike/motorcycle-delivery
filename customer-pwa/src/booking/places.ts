export type PlaceSuggestion = {
  label: string;
  latitude: string;
  longitude: string;
  exact: boolean;
  placeId?: string;
  sessionToken?: string;
};

export type ResolvedPlace = {
  label: string;
  latitude: string;
  longitude: string;
  suburb?: string;
  locality?: string;
};

export type ResolvedLocation = {
  label: string;
  latitude: string;
  longitude: string;
  provider: 'google_places' | 'device';
  placeId: string | null;
  precision: 'exact' | 'area' | 'unverified';
};

export type ManualAddressResolution =
  | { status: 'resolved'; location: ResolvedLocation }
  | { status: 'confirm-pin'; location: ResolvedLocation }
  | { status: 'choose-area'; areas: PlaceSuggestion[] }
  | { status: 'unresolved' };

export function createPlaceSessionToken(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function readPlaceSuggestions(value: unknown): PlaceSuggestion[] {
  if (!isRecord(value) || !Array.isArray(value.suggestions)) throw new Error('Address suggestions are unavailable.');
  const suggestions: PlaceSuggestion[] = [];
  for (const item of value.suggestions) {
    if (!isRecord(item) || typeof item.label !== 'string' || !item.label.trim() || typeof item.exact !== 'boolean') continue;
    const placeId = typeof item.placeId === 'string' && item.placeId.trim() ? item.placeId.trim() : undefined;
    const latitude = coordinate(item.latitude, 90);
    const longitude = coordinate(item.longitude, 180);
    if ((latitude === null || longitude === null) && !placeId) continue;
    suggestions.push({
      label: item.label.trim(),
      latitude: latitude === null ? '' : latitude.toFixed(7),
      longitude: longitude === null ? '' : longitude.toFixed(7),
      exact: item.exact,
      placeId,
    });
    if (suggestions.length === 10) break;
  }
  return suggestions;
}

export function readResolvedPlace(value: unknown): ResolvedPlace {
  if (!isRecord(value) || typeof value.label !== 'string' || !value.label.trim()) {
    throw new Error('Address suggestions are unavailable.');
  }
  const latitude = coordinate(value.latitude, 90);
  const longitude = coordinate(value.longitude, 180);
  if (latitude === null || longitude === null) throw new Error('Address suggestions are unavailable.');
  const suburb = typeof value.suburb === 'string' && value.suburb.trim() ? value.suburb.trim() : undefined;
  const locality = typeof value.locality === 'string' && value.locality.trim() ? value.locality.trim() : undefined;
  return {
    label: value.label.trim(),
    latitude: latitude.toFixed(7),
    longitude: longitude.toFixed(7),
    ...(suburb ? { suburb } : {}),
    ...(locality ? { locality } : {}),
  };
}

export function selectedAddressLabel(suggestionLabel: string, place: { label?: string; suburb?: string; locality?: string }): string {
  const suburb = place.suburb?.trim() ?? '';
  const locality = place.locality?.trim() ?? '';
  let parts = suggestionLabel.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length > 1 && parts[parts.length - 1]?.toLowerCase() === 'zimbabwe') parts.pop();
  if (parts.length === 0) return place.label?.trim() ?? '';
  if (suburb && locality && parts.length > 1) {
    const withoutCity = parts.filter((part) => part.toLowerCase() !== locality.toLowerCase());
    if (withoutCity.length > 0) parts = withoutCity;
  }
  if (suburb && !parts.some((part) => part.toLowerCase().includes(suburb.toLowerCase()))) parts.push(suburb);
  return parts.join(', ');
}

export function resolveManualAddress(
  typedAddress: string,
  suggestions: PlaceSuggestion[],
  devicePoint: { latitude: string; longitude: string } | null,
): ManualAddressResolution {
  const exact = suggestions.find((suggestion) => suggestion.exact && suggestion.placeId);
  if (exact?.placeId) {
    return {
      status: 'resolved',
      location: {
        label: withoutCountry(exact.label),
        latitude: exact.latitude,
        longitude: exact.longitude,
        provider: 'google_places',
        placeId: exact.placeId,
        precision: 'exact',
      },
    };
  }
  if (devicePoint) {
    return {
      status: 'confirm-pin',
      location: {
        label: withoutCountry(typedAddress),
        latitude: devicePoint.latitude,
        longitude: devicePoint.longitude,
        provider: 'device',
        placeId: null,
        precision: 'unverified',
      },
    };
  }
  const areas = suggestions.filter((suggestion) => !suggestion.exact);
  if (areas.length > 0) return { status: 'choose-area', areas };
  return { status: 'unresolved' };
}

export function confirmMapPin(area: PlaceSuggestion): ResolvedLocation {
  return {
    label: withoutCountry(area.label),
    latitude: area.latitude,
    longitude: area.longitude,
    provider: 'google_places',
    placeId: area.placeId ?? null,
    precision: area.exact ? 'exact' : 'area',
  };
}

export function acceptSearchResult<T>(started: number, current: number, value: T): T | null {
  return started === current ? value : null;
}

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

export const MAX_PICKUP_ACCURACY_METRES = 100;
export const MAX_PICKUP_FIX_AGE_MS = 30_000;

export function pickupAutofillFix(input: {
  permission: 'granted' | 'prompt' | 'denied' | 'unknown';
  latitude: number;
  longitude: number;
  accuracyMetres: number | null;
  capturedAt: number;
  now: number;
}): { latitude: string; longitude: string } | null {
  if (input.permission !== 'granted') return null;
  if (input.accuracyMetres == null || input.accuracyMetres > MAX_PICKUP_ACCURACY_METRES) return null;
  if (input.now - input.capturedAt > MAX_PICKUP_FIX_AGE_MS) return null;
  if (!pointInRing(input.longitude, input.latitude, ZIMBABWE_EXTENT)) return null;
  return { latitude: String(input.latitude), longitude: String(input.longitude) };
}

export function decideAddressAutofill(userEdited: boolean, result: { display: string; fullAddress: string; needsStreet: boolean } | null) {
  if (userEdited || !result) return { status: 'ignore' as const, display: '', fullAddress: '' };
  if (result.needsStreet || !result.display) return { status: 'needs-street' as const, display: '', fullAddress: result.fullAddress };
  return { status: 'apply' as const, display: result.display, fullAddress: result.fullAddress };
}

function withoutCountry(label: string): string {
  const parts = label.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length > 1 && parts[parts.length - 1]?.toLowerCase() === 'zimbabwe') parts.pop();
  return parts.join(', ');
}

function coordinate(value: unknown, limit: number): number | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric) || numeric < -limit || numeric > limit) return null;
  return numeric;
}

function pointInRing(longitude: number, latitude: number, ring: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    if (!currentPoint || !previousPoint) continue;
    const crossesLatitude = (currentPoint[1] > latitude) !== (previousPoint[1] > latitude);
    if (!crossesLatitude) continue;
    const edgeLongitude = ((previousPoint[0] - currentPoint[0]) * (latitude - currentPoint[1])) / (previousPoint[1] - currentPoint[1]) + currentPoint[0];
    if (longitude < edgeLongitude) inside = !inside;
  }
  return inside;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
