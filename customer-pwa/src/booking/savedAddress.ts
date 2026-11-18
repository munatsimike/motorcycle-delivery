import type { StopDraft } from './draft';

export type SavedAddressLabel = 'HOME' | 'WORK' | 'CUSTOM';
export type SavedCoordinateSource = 'GOOGLE_PLACES' | 'DEVICE_GEOCODER';

const PLACE_ID = /^[A-Za-z0-9_-]{8,255}$/;

export type SavedAddress = {
  id: string;
  label: SavedAddressLabel;
  customLabel: string | null;
  address: string;
  latitude: string;
  longitude: string;
  placeId: string | null;
  coordinateSource: SavedCoordinateSource;
  contactName: string;
  contactPhone: string;
  isDefaultPickup: boolean;
};

export type SaveState = 'idle' | 'saving' | 'saved';

export type BookingSaveChoice = {
  label: 'HOME' | 'WORK' | null;
};

export function savedAddressLabel(entry: { label: SavedAddressLabel; customLabel: string | null }): string {
  if (entry.label === 'HOME') return 'Home';
  if (entry.label === 'WORK') return 'Work';
  return entry.customLabel?.trim() || 'Saved address';
}

export function filterSavedAddresses(addresses: readonly SavedAddress[], query: string): SavedAddress[] {
  const needle = compactSearchText(query);
  if (!needle) return [...addresses];
  return addresses.filter((entry) => savedAddressSearchFields(entry).some((field) => compactSearchText(field).includes(needle)));
}

function savedAddressSearchFields(entry: SavedAddress): string[] {
  return [entry.contactName, entry.address, entry.contactPhone, savedAddressLabel(entry)];
}

function compactSearchText(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, '');
}

export function emptyAddressList(addresses: readonly SavedAddress[]): boolean {
  return addresses.length === 0;
}

export function skipsPlacesLookup(stop: { latitude: string; longitude: string }): boolean {
  return stop.latitude.trim() !== '' && stop.longitude.trim() !== '';
}

export function stopFromSavedAddress(current: StopDraft, entry: SavedAddress): StopDraft {
  return {
    ...current,
    address: entry.address,
    resolvedAddress: entry.address,
    latitude: entry.latitude,
    longitude: entry.longitude,
    approximate: false,
    precision: 'exact',
    placeId: entry.placeId,
    coordinateSource: entry.coordinateSource,
    contactName: entry.contactName,
    contactPhone: entry.contactPhone,
  };
}

export function automaticGpsMayApply(input: {
  addressEdited: boolean;
  pickup: Pick<StopDraft, 'address' | 'latitude'>;
}): boolean {
  if (input.addressEdited) return false;
  return input.pickup.address.trim() === '' && input.pickup.latitude.trim() === '';
}

export function isRebookState(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'rebook' in state;
}

export function bookingSaveLabel(choice: BookingSaveChoice): { label: 'HOME' | 'WORK'; customLabel: null } | null {
  if (choice.label !== 'HOME' && choice.label !== 'WORK') return null;
  return { label: choice.label, customLabel: null };
}

export function bookingSaveBody(stop: {
  address: string;
  latitude: number;
  longitude: number;
  contactName: string;
  contactPhone: string;
  placeId: string | null;
  coordinateSource: SavedCoordinateSource;
}, choice: { label: 'HOME' | 'WORK'; customLabel: null }) {
  const google = stop.coordinateSource === 'GOOGLE_PLACES' && stop.placeId !== null && PLACE_ID.test(stop.placeId);
  return {
    label: choice.label,
    customLabel: choice.customLabel,
    address: stop.address,
    latitude: stop.latitude.toFixed(7),
    longitude: stop.longitude.toFixed(7),
    placeId: google ? stop.placeId : null,
    coordinateSource: google ? 'GOOGLE_PLACES' as const : 'DEVICE_GEOCODER' as const,
    contactName: stop.contactName,
    contactPhone: stop.contactPhone,
    isDefaultPickup: false,
    reuseExisting: true,
  };
}

export function saveRequest(
  stop: {
    address: string;
    latitude: number;
    longitude: number;
    contactName: string;
    contactPhone: string;
    placeId: string | null;
    coordinateSource: SavedCoordinateSource;
  } | null,
  choice: BookingSaveChoice,
) {
  if (!stop) return null;
  const label = bookingSaveLabel(choice);
  if (!label) return null;
  return bookingSaveBody(stop, label);
}

export function readSavedAddresses(value: unknown): SavedAddress[] {
  if (!Array.isArray(value)) throw new Error('Saved addresses are unavailable.');
  return value.flatMap((item) => {
    const address = readSavedAddress(item);
    return address ? [address] : [];
  });
}

export function readSavedAddress(value: unknown): SavedAddress | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) return null;
  const label = value.label === 'HOME' || value.label === 'WORK' || value.label === 'CUSTOM' ? value.label : null;
  const address = text(value.address);
  const latitude = coordinate(value.latitude, 90);
  const longitude = coordinate(value.longitude, 180);
  const contactName = text(value.contactName);
  const contactPhone = text(value.contactPhone);
  const source = readStoredSource(value.placeId, value.coordinateSource);
  if (!label || !address || !latitude || !longitude || !contactName || !contactPhone || !source || typeof value.isDefaultPickup !== 'boolean') {
    return null;
  }
  const customLabel = value.customLabel == null ? null : text(value.customLabel);
  if (label === 'CUSTOM' && !customLabel) return null;
  if (label !== 'CUSTOM' && value.customLabel != null && value.customLabel !== '') return null;
  return {
    id: value.id,
    label,
    customLabel: label === 'CUSTOM' ? customLabel : null,
    address,
    latitude,
    longitude,
    placeId: source.placeId,
    coordinateSource: source.coordinateSource,
    contactName,
    contactPhone,
    isDefaultPickup: value.isDefaultPickup,
  };
}

export function withoutSavedAddress(addresses: readonly SavedAddress[], id: string): SavedAddress[] {
  return addresses.filter((entry) => entry.id !== id);
}

function readStoredSource(placeId: unknown, source: unknown): { placeId: string | null; coordinateSource: SavedCoordinateSource } | null {
  const id = typeof placeId === 'string' && PLACE_ID.test(placeId.trim()) ? placeId.trim() : null;
  if (placeId != null && placeId !== '' && !id) return null;
  if (source === 'GOOGLE_PLACES') return id ? { placeId: id, coordinateSource: 'GOOGLE_PLACES' } : null;
  if (source === 'DEVICE_GEOCODER') return id ? null : { placeId: null, coordinateSource: 'DEVICE_GEOCODER' };
  if (source != null) return null;
  return id
    ? { placeId: id, coordinateSource: 'GOOGLE_PLACES' }
    : { placeId: null, coordinateSource: 'DEVICE_GEOCODER' };
}

function coordinate(value: unknown, limit: number): string | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric) || numeric < -limit || numeric > limit) return null;
  return numeric.toFixed(7);
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
