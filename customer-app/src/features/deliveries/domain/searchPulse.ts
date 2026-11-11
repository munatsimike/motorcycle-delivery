/** One radar sweep. Long enough to read, short enough to feel active. */
export const SEARCH_PULSE_MS = 2800;
export const SEARCH_RING_COUNT = 3;

const MIN_RADIUS_METRES = 70;
const GROWTH_METRES = 680;
const PEAK_OPACITY = 0.16;

export type SearchRing = {
  radius: number;
  opacity: number;
};

/**
 * Rings for a search centered on a real coordinate.
 * Progress is the fraction of the current sweep, from 0 to 1.
 */
export function searchPulseRings(progress: number, reduceMotion: boolean): SearchRing[] {
  if (reduceMotion) {
    return [{ radius: 260, opacity: 0.14 }];
  }
  const turn = wrap(progress);
  return Array.from({ length: SEARCH_RING_COUNT }, (_, index) => {
    const phase = wrap(turn + index / SEARCH_RING_COUNT);
    return {
      radius: MIN_RADIUS_METRES + phase * GROWTH_METRES,
      opacity: (1 - phase) * PEAK_OPACITY,
    };
  });
}

export function searchRingColor(opacity: number, strength = 1): string {
  const alpha = Math.max(0, Math.min(1, opacity * strength));
  return `rgba(22,155,98,${alpha.toFixed(3)})`;
}

function wrap(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return ((value % 1) + 1) % 1;
}
