import { describe, expect, it } from 'vitest';
import { arrivalLabel, locationAgeLabel, riderFixIsFresh, roadDistanceLabel } from './trackingDisplay';

const NOW = Date.parse('2026-10-28T16:45:00.000Z');

describe('tracking display', () => {
  it('formats road distance and arrival from the same route', () => {
    expect(roadDistanceLabel(350)).toBe('350 m');
    expect(roadDistanceLabel(1200)).toBe('1.2 km');
    expect(roadDistanceLabel(12400)).toBe('12 km');
    expect(roadDistanceLabel(Number.NaN)).toBeNull();
    expect(arrivalLabel(20)).toBe('Less than 1 min');
    expect(arrivalLabel(420)).toBe('7 min');
    expect(arrivalLabel(-1)).toBeNull();
  });

  it('treats a fix older than a minute as no longer live', () => {
    const fresh = new Date(NOW - 5_000).toISOString();
    const stale = new Date(NOW - 61_000).toISOString();
    expect(riderFixIsFresh(fresh, NOW)).toBe(true);
    expect(riderFixIsFresh(stale, NOW)).toBe(false);
    expect(riderFixIsFresh(null, NOW)).toBe(false);
    expect(riderFixIsFresh(undefined, NOW)).toBe(false);
    expect(locationAgeLabel(fresh, NOW)).toBe('Updated 5 seconds ago');
    expect(locationAgeLabel(new Date(NOW - 1_000).toISOString(), NOW)).toBe('Updated just now');
    expect(locationAgeLabel(stale, NOW)).toBe('Updated 1 min ago');
  });
});