import { describe, expect, it } from 'vitest';
import { encodePolyline, readRoadRoute } from './geoapify.js';

describe('Geoapify responses', () => {
  it('reads road distance in metres', () => {
    expect(readRoadRoute({
      features: [{
        properties: { distance: 1540.2 },
        geometry: { type: 'LineString', coordinates: [[31.05, -17.82], [31.06, -17.83]] },
      }],
    })).toEqual({
      metres: 1540.2,
      seconds: null,
      line: [[31.05, -17.82], [31.06, -17.83]],
    });
    expect(readRoadRoute({
      features: [{
        properties: { distance: 1200, time: 420.4 },
        geometry: { type: 'LineString', coordinates: [[31.05, -17.82], [31.06, -17.83]] },
      }],
    })?.seconds).toBe(420.4);
    expect(readRoadRoute({ features: [] })).toBeNull();
    expect(readRoadRoute({
      features: [{
        properties: { distance: 983, time: 124 },
        geometry: {
          type: 'MultiLineString',
          coordinates: [[[4.63, 52.381], [4.631, 52.382], [4.632, 52.383]]],
        },
      }],
    })).toEqual({
      metres: 983,
      seconds: 124,
      line: [[4.63, 52.381], [4.631, 52.382], [4.632, 52.383]],
    });
  });

  it('encodes a route line without putting the API key in the result', () => {
    expect(encodePolyline([[0, 0]])).toBe('??');
    expect(encodePolyline([[31.0522, -17.8292]]).length).toBeGreaterThan(0);
  });
});
