import { normalizeBearing, shortestBearingDelta } from './tracking.ts';

export const MOTORCYCLE_DIRECTIONS = [
  'north',
  'northeast',
  'east',
  'southeast',
  'south',
  'southwest',
  'west',
  'northwest',
] as const;

export type MotorcycleDirection = (typeof MOTORCYCLE_DIRECTIONS)[number];

/** Centre bearing of each sprite. The artwork itself is not rotated. */
export const MOTORCYCLE_DIRECTION_BEARING: Record<MotorcycleDirection, number> = {
  north: 0,
  northeast: 45,
  east: 90,
  southeast: 135,
  south: 180,
  southwest: 225,
  west: 270,
  northwest: 315,
};

/**
 * Extra degrees past a sector boundary before the sprite changes.
 * Adjacent directions are 45 degrees apart, so a 10 degree hold stops
 * a bearing that jitters around the boundary from swapping icons.
 */
export const DIRECTION_HYSTERESIS_DEGREES = 10;
const SECTOR_HALF_DEGREES = 22.5;

/** Stable variety for riders that have no travel bearing. The same id always picks the same sprite. */
export function stableMotorcycleDirection(id: string): MotorcycleDirection {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  }
  return MOTORCYCLE_DIRECTIONS[(hash >>> 0) % MOTORCYCLE_DIRECTIONS.length] ?? 'north';
}

export function nearestMotorcycleDirection(bearing: number): MotorcycleDirection {
  const index = Math.round(normalizeBearing(bearing) / 45) % MOTORCYCLE_DIRECTIONS.length;
  return MOTORCYCLE_DIRECTIONS[index] ?? 'north';
}

/**
 * Nearest of the eight directions. A missing bearing keeps the last sprite.
 * The current sprite stays until the bearing has moved past the shared
 * boundary by [DIRECTION_HYSTERESIS_DEGREES].
 */
export function motorcycleDirection(
  bearing: number | null | undefined,
  current: MotorcycleDirection | null,
): MotorcycleDirection | null {
  if (bearing == null || !Number.isFinite(bearing)) return current;
  const next = nearestMotorcycleDirection(bearing);
  if (current == null || current === next) return next;
  const delta = Math.abs(shortestBearingDelta(MOTORCYCLE_DIRECTION_BEARING[current], normalizeBearing(bearing)));
  if (delta <= SECTOR_HALF_DEGREES + DIRECTION_HYSTERESIS_DEGREES) return current;
  return next;
}

/** Starts a decode for every directional sprite before the first GPS fix. */
export function preloadDirectionalMotorcycles(urls: readonly string[]): void {
  if (typeof Image === 'undefined') return;
  for (const url of urls) {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
  }
}
