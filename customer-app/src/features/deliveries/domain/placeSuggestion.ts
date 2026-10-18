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

export function readPlaceSuggestions(value: unknown): PlaceSuggestion[] {
  if (!isRecord(value) || !Array.isArray(value.suggestions)) {
    throw new Error('Address suggestions are unavailable.');
  }
  const suggestions: PlaceSuggestion[] = [];
  for (const item of value.suggestions) {
    if (!isRecord(item) || typeof item.label !== 'string' || !item.label.trim() || typeof item.exact !== 'boolean') {
      continue;
    }
    const placeId = typeof item.placeId === 'string' && item.placeId.trim() ? item.placeId.trim() : undefined;
    const latitude = coordinate(item.latitude, 90);
    const longitude = coordinate(item.longitude, 180);
    if ((latitude === null || longitude === null) && !placeId) {
      continue;
    }
    suggestions.push({
      label: item.label.trim(),
      latitude: latitude === null ? '' : latitude.toFixed(7),
      longitude: longitude === null ? '' : longitude.toFixed(7),
      exact: item.exact,
      placeId,
    });
    if (suggestions.length === 10) {
      break;
    }
  }
  return suggestions;
}

export function readResolvedPlace(value: unknown): ResolvedPlace {
  if (!isRecord(value) || typeof value.label !== 'string' || !value.label.trim()) {
    throw new Error('Address suggestions are unavailable.');
  }
  const latitude = coordinate(value.latitude, 90);
  const longitude = coordinate(value.longitude, 180);
  if (latitude === null || longitude === null) {
    throw new Error('Address suggestions are unavailable.');
  }
  const suburb = optionalText(value.suburb);
  const locality = optionalText(value.locality);
  return {
    label: value.label.trim(),
    latitude: latitude.toFixed(7),
    longitude: longitude.toFixed(7),
    ...(suburb ? { suburb } : {}),
    ...(locality ? { locality } : {}),
  };
}

/** Keep the house number and street from the tapped suggestion, then the suburb. */
export function selectedAddressLabel(
  suggestionLabel: string,
  place: { label?: string; suburb?: string; locality?: string },
): string {
  const suburb = place.suburb?.trim() ?? '';
  const locality = place.locality?.trim() ?? '';
  let parts = suggestionLabel.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length > 1 && parts[parts.length - 1].toLowerCase() === 'zimbabwe') {
    parts.pop();
  }
  if (parts.length === 0) {
    return place.label?.trim() ?? '';
  }
  if (suburb && locality && parts.length > 1) {
    const withoutCity = parts.filter((part) => part.toLowerCase() !== locality.toLowerCase());
    if (withoutCity.length > 0) {
      parts = withoutCity;
    }
  }
  if (suburb && !parts.some((part) => part.toLowerCase().includes(suburb.toLowerCase()))) {
    parts.push(suburb);
  }
  return parts.join(', ');
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function coordinate(value: unknown, limit: number): number | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric) || numeric < -limit || numeric > limit) {
    return null;
  }
  return numeric;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
