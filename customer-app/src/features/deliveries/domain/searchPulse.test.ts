import { describe, expect, it } from 'vitest';

import { SEARCH_PULSE_MS, SEARCH_RING_COUNT, searchPulseRings, searchRingColor } from './searchPulse';

describe('rider search pulse', () => {
  it('repeats a short sweep with three soft rings', () => {
    expect(SEARCH_PULSE_MS).toBeGreaterThanOrEqual(2500);
    expect(SEARCH_PULSE_MS).toBeLessThanOrEqual(3000);
    const rings = searchPulseRings(0, false);
    expect(rings).toHaveLength(SEARCH_RING_COUNT);
    expect(rings.every((ring) => ring.opacity > 0 && ring.opacity <= 0.16)).toBe(true);
    expect(rings[0]?.radius).toBeLessThan(rings[1]?.radius ?? 0);
    expect(rings[1]?.radius).toBeLessThan(rings[2]?.radius ?? 0);
  });

  it('expands and fades as the sweep advances', () => {
    const start = searchPulseRings(0, false)[0];
    const later = searchPulseRings(0.2, false)[0];
    expect(later?.radius).toBeGreaterThan(start?.radius ?? 0);
    expect(later?.opacity).toBeLessThan(start?.opacity ?? 1);
  });

  it('returns to the same rings when the sweep repeats', () => {
    expect(searchPulseRings(0, false)).toEqual(searchPulseRings(1, false));
    expect(searchPulseRings(1.2, false)).toEqual(searchPulseRings(0.2, false));
  });

  it('uses one static ring when motion is reduced', () => {
    expect(searchPulseRings(0.4, true)).toEqual([{ radius: 260, opacity: 0.14 }]);
  });

  it('keeps the green tint faint', () => {
    expect(searchRingColor(0.16)).toBe('rgba(22,155,98,0.160)');
    expect(searchRingColor(0.16, 1.6)).toBe('rgba(22,155,98,0.256)');
  });
});
