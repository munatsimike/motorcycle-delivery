import { HOUR_MS } from './licence.constants.js';

export const PROFILE_PHOTO_MAX_EDGE = 1_024;
export const PROFILE_PHOTO_UPLOADS_PER_HOUR = 10;
export const PROFILE_PHOTO_ABANDONED_UPLOAD_MS = HOUR_MS;
export const DEFAULT_PROFILE_PHOTO_RETENTION_DAYS = 1;
export const DEFAULT_PROFILE_PHOTO_CLEANUP_INTERVAL_SECONDS = 300;

export function profilePhotoRetentionMs(): number {
  const days = positiveInt(
    process.env.PROFILE_PHOTO_SUPERSEDED_RETENTION_DAYS,
    DEFAULT_PROFILE_PHOTO_RETENTION_DAYS,
    1,
    3650,
  );
  return days * 24 * HOUR_MS;
}

export function profilePhotoCleanupIntervalMs(): number {
  const seconds = positiveInt(
    process.env.PROFILE_PHOTO_CLEANUP_INTERVAL_SECONDS,
    DEFAULT_PROFILE_PHOTO_CLEANUP_INTERVAL_SECONDS,
    30,
    86_400,
  );
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
