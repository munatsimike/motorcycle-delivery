import { describe, expect, it } from 'vitest';

import { nextNearbyMarkers, type NearbyMarker } from './nearbyMarkers';

const now = new Date('2026-11-09T20:00:00.000Z');
const fresh = '2026-11-09T20:00:45.000Z';
const refreshed = '2026-11-09T20:01:05.000Z';
const movedExpiry = '2026-11-09T20:01:25.000Z';

function ids() {
  let next = 0;
  return () => `marker-${++next}`;
}

describe('nearby marker identity', () => {
  it('keeps the same marker when a refresh repeats the coordinates', () => {
    const createId = ids();
    const first = nextNearbyMarkers([], {
      status: 'ready',
      points: [{ latitude: -17.82, longitude: 31.05, expiresAt: fresh }],
    }, createId, now);
    const second = nextNearbyMarkers(first, {
      status: 'ready',
      points: [{ latitude: -17.82, longitude: 31.05, expiresAt: refreshed }],
    }, createId, now);

    expect(second.map((marker) => marker.id)).toEqual(first.map((marker) => marker.id));
    expect(second[0]?.expiresAt).toBe(refreshed);
    expect(createId()).toBe('marker-2');
  });

  it('moves an existing marker when the same approximate position updates', () => {
    const createId = ids();
    const first = nextNearbyMarkers([], {
      status: 'ready',
      points: [{ latitude: -17.82, longitude: 31.05, expiresAt: fresh }],
    }, createId, now);
    const second = nextNearbyMarkers(first, {
      status: 'ready',
      points: [{ latitude: -17.821, longitude: 31.051, expiresAt: movedExpiry }],
    }, createId, now);

    expect(second).toEqual([{
      id: first[0]?.id,
      latitude: -17.821,
      longitude: 31.051,
      expiresAt: movedExpiry,
    }]);
  });

  it('keeps the last unexpired markers when the refresh fails', () => {
    const previous = marker('marker-1', -17.82, 31.05, fresh);
    expect(nextNearbyMarkers([previous], { status: 'failed' }, ids(), now)).toEqual([previous]);
  });

  it('clears markers after a successful response with no riders', () => {
    const previous = marker('marker-1', -17.82, 31.05, fresh);
    expect(nextNearbyMarkers([previous], { status: 'ready', points: [] }, ids(), now)).toEqual([]);
  });

  it('drops a marker whose latest coordinates are already expired', () => {
    const previous = marker('marker-1', -17.82, 31.05, fresh);
    expect(nextNearbyMarkers([previous], {
      status: 'ready',
      points: [{ latitude: -17.82, longitude: 31.05, expiresAt: '2026-11-09T19:59:00.000Z' }],
    }, ids(), now)).toEqual([]);
  });

  it('drops an expired marker instead of keeping it through a failed refresh', () => {
    const expired = marker('marker-1', -17.82, 31.05, '2026-11-09T19:59:00.000Z');
    const current = marker('marker-2', -17.821, 31.051, fresh);
    expect(nextNearbyMarkers([expired, current], { status: 'failed' }, ids(), now)).toEqual([current]);
  });

  it('removes a rider the latest successful response no longer includes', () => {
    const createId = ids();
    const shown = nextNearbyMarkers([], {
      status: 'ready',
      points: [
        { latitude: -17.82, longitude: 31.05, expiresAt: fresh },
        { latitude: -17.83, longitude: 31.06, expiresAt: fresh },
      ],
    }, createId, now);
    const remaining = nextNearbyMarkers(shown, {
      status: 'ready',
      points: [{ latitude: -17.83, longitude: 31.06, expiresAt: refreshed }],
    }, createId, now);

    expect(remaining.map((point) => point.id)).toEqual([shown[1]?.id]);
  });

  it('reuses marker ids across repeated polls when only the expiry changes', () => {
    const createId = ids();
    let shown = nextNearbyMarkers([], {
      status: 'ready',
      points: [
        { latitude: -17.82, longitude: 31.05, expiresAt: fresh },
        { latitude: -17.825, longitude: 31.055, expiresAt: fresh },
      ],
    }, createId, now);
    const firstIds = shown.map((point) => point.id);

    shown = nextNearbyMarkers(shown, {
      status: 'ready',
      points: [
        { latitude: -17.82, longitude: 31.05, expiresAt: refreshed },
        { latitude: -17.825, longitude: 31.055, expiresAt: refreshed },
      ],
    }, createId, now);
    shown = nextNearbyMarkers(shown, {
      status: 'ready',
      points: [
        { latitude: -17.8204, longitude: 31.0504, expiresAt: movedExpiry },
        { latitude: -17.8254, longitude: 31.0554, expiresAt: movedExpiry },
      ],
    }, createId, now);

    expect(shown.map((point) => point.id)).toEqual(firstIds);
    expect(new Set(shown.map((point) => point.id)).size).toBe(2);
  });

  it('does not reuse a marker for an unrelated point across the neighborhood', () => {
    const createId = ids();
    const first = nextNearbyMarkers([], {
      status: 'ready',
      points: [{ latitude: -17.82, longitude: 31.05, expiresAt: fresh }],
    }, createId, now);
    const second = nextNearbyMarkers(first, {
      status: 'ready',
      points: [{ latitude: -17.8, longitude: 31.07, expiresAt: refreshed }],
    }, createId, now);

    expect(second[0]?.id).not.toBe(first[0]?.id);
  });
});

function marker(id: string, latitude: number, longitude: number, expiresAt: string): NearbyMarker {
  return { id, latitude, longitude, expiresAt };
}
