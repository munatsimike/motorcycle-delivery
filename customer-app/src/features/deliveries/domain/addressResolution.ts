import type { PlaceSuggestion } from './placeSuggestion';

export type LocationProvider = 'google_places' | 'device';
export type LocationPrecision = 'exact' | 'area' | 'unverified';

export type ResolvedLocation = {
  label: string;
  latitude: string;
  longitude: string;
  provider: LocationProvider;
  placeId: string | null;
  precision: LocationPrecision;
};

export type DevicePoint = {
  latitude: string;
  longitude: string;
};

export type ManualAddressResolution =
  | { status: 'resolved'; location: ResolvedLocation }
  | { status: 'confirm-pin'; location: ResolvedLocation }
  | { status: 'choose-area'; areas: PlaceSuggestion[] }
  | { status: 'unresolved' };

export function resolveManualAddress(
  typedAddress: string,
  suggestions: PlaceSuggestion[],
  devicePoint: DevicePoint | null,
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
  if (areas.length > 0) {
    return { status: 'choose-area', areas };
  }
  return { status: 'unresolved' };
}

function withoutCountry(label: string): string {
  const parts = label.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length > 1 && parts[parts.length - 1].toLowerCase() === 'zimbabwe') {
    parts.pop();
  }
  return parts.join(', ');
}

/** When the match has no house number, the address the customer typed is the number. */
export function typedHouseNumber(typedAddress: string, precision: LocationPrecision): string {
  if (precision === 'exact') {
    return '';
  }
  return typedAddress.trim().replace(/\s+/g, ' ').slice(0, 200);
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
