import { describe, expect, it } from 'vitest';
import { encodePolyline, GeoapifyClient, readRoadRoute } from './geoapify.js';

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
      steps: [],
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
      steps: [],
    });
  });

  it('keeps maneuver steps and their geometry indexes', () => {
    expect(readRoadRoute({
      features: [{
        properties: {
          distance: 240,
          time: 40,
          legs: [{
            steps: [{
              distance: 240,
              time: 40,
              from_index: 0,
              to_index: 2,
              instruction: { text: 'Turn left onto First Street', type: 'Left', streets: ['First Street'] },
            }, {
              instruction: { text: 'Continue', type: 'Straight' },
            }],
          }],
        },
        geometry: { type: 'LineString', coordinates: [[31.05, -17.82], [31.06, -17.83], [31.07, -17.84]] },
      }],
    })?.steps).toEqual([{
      text: 'Turn left onto First Street',
      type: 'Left',
      streets: ['First Street'],
      metres: 240,
      seconds: 40,
      fromIndex: 0,
      toIndex: 2,
      longitude: 31.05,
      latitude: -17.82,
    }]);
  });

  it('requests instruction details and leaves route details off', async () => {
    let requested = '';
    const client = new GeoapifyClient('test-key', async (input) => {
      requested = String(input);
      return new Response(JSON.stringify({
        features: [{
          properties: { distance: 10, time: 2 },
          geometry: { type: 'LineString', coordinates: [[31, -17], [31.001, -17.001]] },
        }],
      }));
    });
    await client.route(-17, 31, -17.001, 31.001);
    const url = new URL(requested);
    expect(url.searchParams.get('details')).toBe('instruction_details');
    expect(url.searchParams.get('mode')).toBe('drive');
    expect(url.searchParams.has('route_details')).toBe(false);
    expect(url.searchParams.get('apiKey')).toBe('test-key');
  });

  it('encodes a route line without putting the API key in the result', () => {
    expect(encodePolyline([[0, 0]])).toBe('??');
    expect(encodePolyline([[31.0522, -17.8292]]).length).toBeGreaterThan(0);
  });
});
