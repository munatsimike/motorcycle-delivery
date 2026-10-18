import { describe, expect, it } from 'vitest';
import { autocompleteRequestUrl, encodePolyline, readPlaceSuggestions, readRoadRoute } from './geoapify.js';
import { readSearchBias } from './places.service.js';

describe('Geoapify responses', () => {
  it('keeps Zimbabwe suggestions and marks a suburb as approximate', () => {
    const suggestions = readPlaceSuggestions({
      results: [
        {
          formatted: '66 Mungongoma Road, Mufakose, Harare, Zimbabwe',
          suburb: 'Mufakose',
          city: 'Harare',
          lat: -17.89,
          lon: 30.96,
          result_type: 'building',
          housenumber: '66',
        },
        {
          formatted: '1st Circle, Harare, Zimbabwe',
          suburb: 'Budiriro',
          city: 'Harare',
          lat: -17.88,
          lon: 30.93,
          result_type: 'street',
        },
        {
          formatted: 'Samora Machel Avenue, Harare, Zimbabwe',
          city: 'Harare',
          lat: -17.83,
          lon: 31.05,
          result_type: 'street',
        },
        {
          formatted: 'Mufakose, Harare, Zimbabwe',
          suburb: 'Mufakose',
          city: 'Harare',
          lat: -17.9,
          lon: 30.95,
          result_type: 'suburb',
        },
      ],
    });
    expect(suggestions).toEqual([
      {
        label: '66 Mungongoma Road, Mufakose',
        latitude: -17.89,
        longitude: 30.96,
        exact: true,
      },
      {
        label: '1st Circle, Budiriro',
        latitude: -17.88,
        longitude: 30.93,
        exact: true,
      },
      {
        label: 'Samora Machel Avenue, Harare',
        latitude: -17.83,
        longitude: 31.05,
        exact: true,
      },
      {
        label: 'Mufakose',
        latitude: -17.9,
        longitude: 30.95,
        exact: false,
      },
    ]);
  });

  it('keeps suburb and landmark matches and stops at ten', () => {
    const results = Array.from({ length: 12 }, (_, index) => ({
      formatted: `Place ${index}, Harare, Zimbabwe`,
      lat: -17.8,
      lon: 31,
      result_type: index % 2 === 0 ? 'suburb' : 'amenity',
    }));
    expect(readPlaceSuggestions({ results })).toHaveLength(10);
    expect(readPlaceSuggestions({ results }).every((item) => item.exact === false)).toBe(true);
  });

  it('filters to Zimbabwe and biases nearby results without a place type', () => {
    const url = autocompleteRequestUrl('Budiriro', 'test-key', { latitude: -17.88, longitude: 30.93 });
    expect(url.searchParams.get('filter')).toBe('countrycode:zw');
    expect(url.searchParams.get('bias')).toBe('proximity:30.93,-17.88');
    expect(url.searchParams.get('limit')).toBe('10');
    expect(url.searchParams.get('type')).toBeNull();
    expect(autocompleteRequestUrl('Budiriro', 'test-key').searchParams.get('bias')).toBeNull();
    expect(readSearchBias('-17.88', '30.93')).toEqual({ latitude: -17.88, longitude: 30.93 });
    expect(readSearchBias('south', '30.93')).toBeNull();
  });

  it('reads road distance in metres', () => {
    expect(readRoadRoute({
      features: [{
        properties: { distance: 1540.2 },
        geometry: { type: 'LineString', coordinates: [[31.05, -17.82], [31.06, -17.83]] },
      }],
    })).toEqual({
      metres: 1540.2,
      line: [[31.05, -17.82], [31.06, -17.83]],
    });
    expect(readRoadRoute({ features: [] })).toBeNull();
  });

  it('encodes a route line without putting the API key in the result', () => {
    expect(encodePolyline([[0, 0]])).toBe('??');
    expect(encodePolyline([[31.0522, -17.8292]]).length).toBeGreaterThan(0);
  });
});
