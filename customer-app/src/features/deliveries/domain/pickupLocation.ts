import type { StopDraft } from './bookingDraft';

export const OUTSIDE_SERVICE_AREA = 'Riders currently supports deliveries within Zimbabwe.';
export const LOCATION_PERMISSION_MESSAGE = 'Location permission is needed to detect your pickup point.';
export const LOCATION_SERVICES_MESSAGE = 'Turn on your device location and try again.';
export const LOCATION_UNAVAILABLE_MESSAGE = 'We couldn\'t detect your location. Try again or search for your pickup address.';

export const MAX_PICKUP_ACCURACY_METRES = 100;
export const MAX_PICKUP_FIX_AGE_MS = 30_000;

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

export type ReverseGeocodeParts = {
  name?: string | null;
  streetNumber?: string | null;
  street?: string | null;
  district?: string | null;
  city?: string | null;
  subregion?: string | null;
  region?: string | null;
  country?: string | null;
  isoCountryCode?: string | null;
};

export type ReverseAddress = {
  /** Street number, street, and suburb shown in the field. */
  display: string;
  /** Complete address kept with the coordinates. */
  fullAddress: string;
  /** The lookup named a city but not a street. */
  needsStreet: boolean;
};

export const STREET_ADDRESS_PROMPT = 'Enter the street address';
export const ADDRESS_SEARCH_LABEL = 'Searching for address…';

export type AddressAutofillDecision = {
  status: 'apply' | 'needs-street' | 'ignore';
  display: string;
  fullAddress: string;
};

export type PickupFix = {
  latitude: number;
  longitude: number;
  accuracyMetres: number | null;
  capturedAt: number;
};

export type PickupPermission = 'granted' | 'denied' | 'blocked';

export type PickupDetection =
  | { status: 'permission-denied' | 'permission-blocked' | 'services-off' | 'unavailable' | 'unsupported' }
  | {
    status: 'confirm';
    latitude: string;
    longitude: string;
    address: string;
    fullAddress: string;
    needsStreet: boolean;
    accuracyMetres: number;
  };

type PickupDetectionPorts = {
  servicesEnabled: boolean;
  permission: PickupPermission;
  requestPermission: () => Promise<PickupPermission>;
  readFix: () => Promise<PickupFix | 'timeout' | 'invalid'>;
  reverseGeocode: (latitude: number, longitude: number) => Promise<ReverseAddress | null>;
  now: number;
};

export function showsCurrentLocationAction(step: string): boolean {
  return step === 'pickup';
}

export function startPickupDetection(state: { inFlight: boolean }): boolean {
  if (state.inFlight) {
    return false;
  }
  state.inFlight = true;
  return true;
}

export function finishPickupDetection(state: { inFlight: boolean }): void {
  state.inFlight = false;
}

export function pickupLocationMessage(status: Exclude<PickupDetection['status'], 'confirm'>): string {
  if (status === 'permission-denied' || status === 'permission-blocked') {
    return LOCATION_PERMISSION_MESSAGE;
  }
  if (status === 'services-off') {
    return LOCATION_SERVICES_MESSAGE;
  }
  if (status === 'unsupported') {
    return OUTSIDE_SERVICE_AREA;
  }
  return LOCATION_UNAVAILABLE_MESSAGE;
}

export function clientAllowsCoordinate(latitude: number, longitude: number, development: boolean): boolean {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return false;
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return false;
  }
  if (pointInRing(longitude, latitude, ZIMBABWE_EXTENT)) {
    return true;
  }
  return development;
}

export function classifyGpsFix(fix: PickupFix, now: number): 'ok' | 'invalid' {
  if (!Number.isFinite(fix.latitude) || fix.latitude < -90 || fix.latitude > 90) {
    return 'invalid';
  }
  if (!Number.isFinite(fix.longitude) || fix.longitude < -180 || fix.longitude > 180) {
    return 'invalid';
  }
  if (
    fix.accuracyMetres === null
    || !Number.isFinite(fix.accuracyMetres)
    || fix.accuracyMetres <= 0
    || fix.accuracyMetres > MAX_PICKUP_ACCURACY_METRES
  ) {
    return 'invalid';
  }
  if (!Number.isFinite(fix.capturedAt) || now - fix.capturedAt > MAX_PICKUP_FIX_AGE_MS || fix.capturedAt - now > 5_000) {
    return 'invalid';
  }
  return 'ok';
}

export function formatReverseAddress(parts: ReverseGeocodeParts | null | undefined): string | null {
  return readReverseAddress(parts)?.display || null;
}

/**
 * A Zimbabwe lookup shows the street and suburb in the field.
 * City and country stay on the stored address. A city-only result does not fill the field.
 */
export function readReverseAddress(parts: ReverseGeocodeParts | null | undefined): ReverseAddress | null {
  if (!parts) {
    return null;
  }
  const city = text(parts.city) || text(parts.region);
  const country = text(parts.country);
  const suburb = suburbName(parts, city);
  const street = streetLine(parts, city, suburb, country);
  const zimbabwe = isZimbabwe(parts);
  const display = unique(zimbabwe ? [street, suburb] : [street, suburb, city]).join(', ');
  const fullAddress = unique([street, suburb, city, country]).join(', ');
  if (!display && !fullAddress) {
    return null;
  }
  const needsStreet = zimbabwe && street.length === 0;
  return {
    display: needsStreet ? '' : display,
    fullAddress,
    needsStreet,
  };
}

/** A lookup that finishes after the customer has typed must not replace that text. */
export function decideAddressAutofill(userEdited: boolean, result: ReverseAddress | null): AddressAutofillDecision {
  if (userEdited || !result) {
    return { status: 'ignore', display: '', fullAddress: '' };
  }
  if (result.needsStreet || !result.display) {
    return { status: 'needs-street', display: '', fullAddress: result.fullAddress };
  }
  return { status: 'apply', display: result.display, fullAddress: result.fullAddress };
}

export async function detectPickupLocation(
  ports: PickupDetectionPorts,
  development: boolean,
): Promise<PickupDetection> {
  let permission = ports.permission;
  if (permission === 'blocked') {
    return { status: 'permission-blocked' };
  }
  if (permission !== 'granted') {
    permission = await ports.requestPermission();
    if (permission === 'blocked') {
      return { status: 'permission-blocked' };
    }
    if (permission !== 'granted') {
      return { status: 'permission-denied' };
    }
  }
  if (!ports.servicesEnabled) {
    return { status: 'services-off' };
  }
  const fix = await ports.readFix();
  if (fix === 'timeout' || fix === 'invalid' || classifyGpsFix(fix, ports.now) !== 'ok') {
    return { status: 'unavailable' };
  }
  if (!clientAllowsCoordinate(fix.latitude, fix.longitude, development)) {
    return { status: 'unsupported' };
  }
  let found: ReverseAddress | null = null;
  try {
    found = await ports.reverseGeocode(fix.latitude, fix.longitude);
  } catch {
    found = null;
  }
  const decision = decideAddressAutofill(false, found);
  return {
    status: 'confirm',
    latitude: fix.latitude.toFixed(7),
    longitude: fix.longitude.toFixed(7),
    address: decision.display,
    fullAddress: decision.status === 'ignore' ? '' : decision.fullAddress,
    needsStreet: decision.status === 'needs-street',
    accuracyMetres: fix.accuracyMetres ?? 0,
  };
}

export async function runPickupDetection(
  state: { inFlight: boolean },
  detect: () => Promise<PickupDetection>,
): Promise<PickupDetection | { status: 'busy' }> {
  if (!startPickupDetection(state)) {
    return { status: 'busy' };
  }
  try {
    return await detect();
  } finally {
    finishPickupDetection(state);
  }
}

export function applyConfirmedPickup(
  confirmed: { latitude: string; longitude: string; address: string; landmark: string; resolvedAddress?: string },
): { ok: true; patch: Partial<StopDraft> } | { ok: false; error: string } {
  const address = normalizeText(confirmed.address);
  if (!address || address.length > 500) {
    return { ok: false, error: 'Enter the pickup address' };
  }
  const landmark = normalizeText(confirmed.landmark);
  if (landmark.length > 200) {
    return { ok: false, error: 'Enter the pickup landmark' };
  }
  const latitude = Number(confirmed.latitude);
  const longitude = Number(confirmed.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { ok: false, error: LOCATION_UNAVAILABLE_MESSAGE };
  }
  return {
    ok: true,
    patch: {
      address,
      resolvedAddress: storedAddress(address, confirmed.resolvedAddress),
      landmark,
      latitude: confirmed.latitude,
      longitude: confirmed.longitude,
      approximate: false,
      precision: 'exact',
      placeId: null,
      coordinateSource: 'DEVICE_GEOCODER',
    },
  };
}

export function pickupAfterCancel<T>(current: T): T {
  return current;
}

function normalizeText(value: string): string {
  const textValue = value.trim().replace(/\s+/g, ' ');
  if (/[\u0000-\u001f]/.test(textValue)) {
    return '';
  }
  return textValue;
}

function storedAddress(visible: string, resolved: string | undefined): string {
  const full = normalizeText(resolved ?? '');
  if (!full || full.toLowerCase() === visible.toLowerCase()) {
    return '';
  }
  return full;
}

function streetLine(parts: ReverseGeocodeParts, city: string, suburb: string, country: string): string {
  const number = text(parts.streetNumber);
  const street = text(parts.street);
  if (number && street) {
    return street.toLowerCase().startsWith(`${number.toLowerCase()} `) ? street : `${number} ${street}`;
  }
  if (street || number) {
    return street || number;
  }
  const name = text(parts.name);
  const blocked = new Set([city, suburb, country, text(parts.region), text(parts.district), text(parts.subregion)]
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase()));
  return name && !blocked.has(name.toLowerCase()) ? name : '';
}

function suburbName(parts: ReverseGeocodeParts, city: string): string {
  const cityKey = city.toLowerCase();
  const regionKey = text(parts.region).toLowerCase();
  const district = text(parts.district);
  if (district && district.toLowerCase() !== cityKey) {
    return district;
  }
  const subregion = text(parts.subregion);
  if (subregion && subregion.toLowerCase() !== cityKey && subregion.toLowerCase() !== regionKey) {
    return subregion;
  }
  return '';
}

function isZimbabwe(parts: ReverseGeocodeParts): boolean {
  const country = text(parts.country).toLowerCase();
  const code = text(parts.isoCountryCode).toLowerCase();
  if (code === 'zw' || country === 'zimbabwe') {
    return true;
  }
  return country.length === 0 && code.length === 0;
}

function text(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
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
