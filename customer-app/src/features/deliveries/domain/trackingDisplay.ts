export const LIVE_LOCATION_MAX_AGE_MS = 60_000;

export function roadDistanceLabel(metres: number): string | null {
  if (!Number.isFinite(metres) || metres < 0) {
    return null;
  }
  if (metres < 1000) {
    return `${Math.round(metres)} m`;
  }
  const kilometres = metres / 1000;
  const digits = kilometres >= 10 ? 0 : 1;
  return `${kilometres.toFixed(digits)} km`;
}

export function arrivalLabel(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  if (seconds < 30) {
    return 'Less than 1 min';
  }
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} min`;
}

export function riderFixIsFresh(updatedAt: string | null | undefined, now: number): boolean {
  if (!updatedAt) {
    return false;
  }
  const time = new Date(updatedAt).getTime();
  if (Number.isNaN(time)) {
    return false;
  }
  const age = now - time;
  return age >= -5_000 && age <= LIVE_LOCATION_MAX_AGE_MS;
}

export function locationAgeLabel(updatedAt: string | null | undefined, now: number): string | null {
  if (!updatedAt) {
    return null;
  }
  const time = new Date(updatedAt).getTime();
  if (Number.isNaN(time)) {
    return null;
  }
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 5) {
    return 'Updated just now';
  }
  if (seconds < 60) {
    return `Updated ${seconds} seconds ago`;
  }
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? 'Updated 1 min ago' : `Updated ${minutes} min ago`;
}
