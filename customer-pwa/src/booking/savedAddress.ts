import type { StopDraft } from './draft';

export type SavedAddressLabel = 'HOME' | 'WORK' | 'CUSTOM';

export type SavedAddress = {
  id: string;
  label: SavedAddressLabel;
  customLabel: string | null;
  address: string;
  latitude: string;
  longitude: string;
  contactName: string;
  contactPhone: string;
  isDefaultPickup: boolean;
};

export type SaveState = 'idle' | 'saving' | 'saved';

export function savedAddressLabel(entry: { label: SavedAddressLabel; customLabel: string | null }): string {
  if (entry.label === 'HOME') return 'Home';
  if (entry.label === 'WORK') return 'Work';
  return entry.customLabel?.trim() || 'Custom';
}

export function emptyAddressList(addresses: readonly SavedAddress[]): boolean {
  return addresses.length === 0;
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
    placeId: null,
    coordinateSource: 'DEVICE_GEOCODER',
    contactName: entry.contactName,
    contactPhone: entry.contactPhone,
  };
}

export function canApplyDefaultPickup(input: {
  rebook: boolean;
  pickup: Pick<StopDraft, 'address' | 'latitude' | 'longitude'>;
}): boolean {
  if (input.rebook) return false;
  return input.pickup.address.trim() === '' && input.pickup.latitude.trim() === '' && input.pickup.longitude.trim() === '';
}

export function isRebookState(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'rebook' in state;
}

export function bookingSaveBody(stop: {
  address: string;
  latitude: number;
  longitude: number;
  contactName: string;
  contactPhone: string;
}, customLabel: 'Pickup' | 'Delivery') {
  return {
    label: 'CUSTOM' as const,
    customLabel,
    address: stop.address,
    latitude: stop.latitude.toFixed(7),
    longitude: stop.longitude.toFixed(7),
    placeId: null,
    coordinateSource: 'DEVICE_GEOCODER' as const,
    contactName: stop.contactName,
    contactPhone: stop.contactPhone,
    isDefaultPickup: false,
    reuseExisting: true,
  };
}

export function readSavedAddresses(value: unknown): SavedAddress[] {
  if (!Array.isArray(value)) throw new Error('Saved addresses are unavailable.');
  return value.map(readSavedAddress);
}

export function readSavedAddress(value: unknown): SavedAddress {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) {
    throw new Error('Saved addresses are unavailable.');
  }
  const label = value.label === 'HOME' || value.label === 'WORK' || value.label === 'CUSTOM' ? value.label : null;
  const address = text(value.address);
  const latitude = coordinate(value.latitude, 90);
  const longitude = coordinate(value.longitude, 180);
  const contactName = text(value.contactName);
  const contactPhone = text(value.contactPhone);
  if (!label || !address || !latitude || !longitude || !contactName || !contactPhone || typeof value.isDefaultPickup !== 'boolean') {
    throw new Error('Saved addresses are unavailable.');
  }
  const customLabel = value.customLabel == null ? null : text(value.customLabel);
  if (label === 'CUSTOM' && !customLabel) throw new Error('Saved addresses are unavailable.');
  return {
    id: value.id,
    label,
    customLabel: label === 'CUSTOM' ? customLabel : null,
    address,
    latitude,
    longitude,
    contactName,
    contactPhone,
    isDefaultPickup: value.isDefaultPickup,
  };
}

export function withoutSavedAddress(addresses: readonly SavedAddress[], id: string): SavedAddress[] {
  return addresses.filter((entry) => entry.id !== id);
}

export function withDefaultPickup(addresses: readonly SavedAddress[], id: string): SavedAddress[] {
  return addresses.map((entry) => ({ ...entry, isDefaultPickup: entry.id === id }));
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
