export const INCOMING_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_STORED_IMAGE_MAX_BYTES = INCOMING_IMAGE_MAX_BYTES;
export const MAX_IMAGE_EDGE = 8_000;
export const LICENCE_UPLOADS_PER_HOUR = 5;
export const HOUR_MS = 60 * 60 * 1000;
export const ABANDONED_UPLOAD_MS = HOUR_MS;
export const DEFAULT_SUPERSEDED_RETENTION_DAYS = 90;
export const DEFAULT_CLEANUP_INTERVAL_SECONDS = 300;

export function maxStoredBytes(): number {
  return positiveInt(process.env.LICENCE_STORAGE_MAX_BYTES, DEFAULT_STORED_IMAGE_MAX_BYTES, 1, 20 * 1024 * 1024);
}

export function supersededRetentionMs(): number {
  const days = positiveInt(process.env.LICENCE_SUPERSEDED_RETENTION_DAYS, DEFAULT_SUPERSEDED_RETENTION_DAYS, 1, 3650);
  return days * 24 * HOUR_MS;
}

export function cleanupIntervalMs(): number {
  const seconds = positiveInt(process.env.LICENCE_CLEANUP_INTERVAL_SECONDS, DEFAULT_CLEANUP_INTERVAL_SECONDS, 30, 86_400);
  return seconds * 1000;
}

function positiveInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return fallback;
  }
  return parsed;
}
