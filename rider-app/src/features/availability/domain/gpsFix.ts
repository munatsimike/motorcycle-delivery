export type GpsFix = {
  latitude: number;
  longitude: number;
};

export function readGpsFix(latitude: unknown, longitude: unknown): GpsFix | null {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return null;
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }
  return { latitude, longitude };
}

export function readLatestTaskFix(data: unknown): GpsFix | null {
  if (!isRecord(data) || !Array.isArray(data.locations)) {
    return null;
  }
  let latest: GpsFix | null = null;
  for (const item of data.locations) {
    if (!isRecord(item) || !isRecord(item.coords)) {
      continue;
    }
    const fix = readGpsFix(item.coords.latitude, item.coords.longitude);
    if (fix) {
      latest = fix;
    }
  }
  return latest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
