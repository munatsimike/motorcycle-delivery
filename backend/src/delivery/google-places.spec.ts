import { describe, expect, it } from 'vitest';

import {
  autocompleteBody,
  GooglePlacesClient,
  isPlaceId,
  isSessionToken,
  readAutocompleteSuggestions,
  readPlaceLocation,
  readResolvedPlace,
} from './google-places.js';
import { readSearchBias } from './places.service.js';

const TOKEN = '4f3b2a10-6c2d-4b1a-8f3e-9a1b2c3d4e5f';

describe('Google Places autocomplete', () => {
  it('restricts suggestions to Zimbabwe and biases a provided point without a city centre', () => {
    const body = autocompleteBody('Budiriro', TOKEN, { latitude: -17.88, longitude: 30.93 });
    expect(body.includedRegionCodes).toEqual(['zw']);
    expect(body.sessionToken).toBe(TOKEN);
    expect(body.locationBias).toEqual({
      circle: {
        center: { latitude: -17.88, longitude: 30.93 },
        radius: 50_000,
      },
    });
    expect(autocompleteBody('Budiriro', TOKEN, null).locationBias).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('31.05');
  });

  it('reads streets, suburbs, and landmarks without expecting coordinates', () => {
    const suggestions = readAutocompleteSuggestions({
      suggestions: [
        {
          placePrediction: {
            placeId: 'ChIJstreet0001',
            text: { text: 'Samora Machel Avenue, Harare, Zimbabwe' },
            types: ['route'],
          },
        },
        {
          placePrediction: {
            placeId: 'ChIJsuburb0001',
            text: { text: 'Mufakose, Harare, Zimbabwe' },
            types: ['sublocality', 'political'],
          },
        },
        { queryPrediction: { text: { text: 'Budiriro shops' } } },
      ],
    });
    expect(suggestions).toEqual([
      { label: 'Samora Machel Avenue, Harare', placeId: 'ChIJstreet0001', exact: true },
      { label: 'Mufakose, Harare', placeId: 'ChIJsuburb0001', exact: false },
    ]);
  });

  it('reads coordinates only from place details', () => {
    expect(readResolvedPlace({
      id: 'ChIJstreet0001',
      formattedAddress: '66 Mungongoma Road, Mufakose, Harare, Zimbabwe',
      location: { latitude: -17.89, longitude: 30.96 },
    })).toEqual({
      label: '66 Mungongoma Road, Mufakose, Harare',
      latitude: -17.89,
      longitude: 30.96,
    });
    expect(readResolvedPlace({
      id: 'ChIJmungongoma',
      formattedAddress: 'Mungongoma Rd, Harare, Zimbabwe',
      location: { latitude: -17.89, longitude: 30.96 },
      addressComponents: [
        { longText: 'Mungongoma Road', types: ['route'] },
        { longText: 'Mufakose', types: ['sublocality_level_1', 'sublocality', 'political'] },
        { longText: 'Harare', types: ['locality', 'political'] },
        { longText: 'Zimbabwe', types: ['country', 'political'] },
      ],
    })).toEqual({
      label: 'Mungongoma Road, Mufakose',
      latitude: -17.89,
      longitude: 30.96,
      suburb: 'Mufakose',
      locality: 'Harare',
    });
    expect(readResolvedPlace({
      formattedAddress: 'Galloway Rd, Norton, Zimbabwe',
      location: { latitude: -17.88, longitude: 30.7 },
      addressComponents: [
        { longText: '208', types: ['street_number'] },
        { longText: 'Galloway Road', types: ['route'] },
        { longText: 'Norton', types: ['locality', 'political'] },
      ],
    })).toMatchObject({ label: '208 Galloway Road, Norton', locality: 'Norton' });
    expect(readResolvedPlace({ formattedAddress: 'Mufakose, Harare' })).toBeNull();
    expect(isSessionToken(TOKEN)).toBe(true);
    expect(isSessionToken('not-a-token')).toBe(false);
    expect(isPlaceId('ChIJstreet0001')).toBe(true);
    expect(readSearchBias('-17.88', '30.93')).toEqual({ latitude: -17.88, longitude: 30.93 });
    expect(readSearchBias('south', '30.93')).toBeNull();
  });

  it('refreshes a place location without putting the API key in the URL', async () => {
    const key = 'test-maps-key';
    let requested = '';
    let fieldMask = '';
    let cacheMode = '';
    let cacheHeader = '';
    const client = new GooglePlacesClient(key, async (url, init) => {
      requested = String(url);
      fieldMask = new Headers(init?.headers).get('X-Goog-FieldMask') ?? '';
      cacheMode = init?.cache ?? '';
      cacheHeader = new Headers(init?.headers).get('Cache-Control') ?? '';
      return new Response(JSON.stringify({ location: { latitude: -17.89, longitude: 30.96 } }));
    });
    expect(await client.location('ChIJstreet0001')).toEqual({ latitude: -17.89, longitude: 30.96 });
    expect(requested).not.toContain(key);
    expect(requested).not.toContain('sessionToken');
    expect(requested).not.toContain('-17.8292123');
    expect(fieldMask).toBe('location');
    expect(cacheMode).toBe('no-store');
    expect(cacheHeader).toBe('no-cache');
    expect(readPlaceLocation({ location: { latitude: 91, longitude: 0 } })).toBeNull();
  });
});
