export type PlaceSuggestion = {
  label: string;
  latitude: string;
  longitude: string;
  exact: boolean;
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
    const latitude = coordinate(item.latitude, 90);
    const longitude = coordinate(item.longitude, 180);
    if (latitude === null || longitude === null) {
      continue;
    }
    suggestions.push({
      label: item.label.trim(),
      latitude: latitude.toFixed(7),
      longitude: longitude.toFixed(7),
      exact: item.exact,
    });
    if (suggestions.length === 10) {
      break;
    }
  }
  return suggestions;
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
