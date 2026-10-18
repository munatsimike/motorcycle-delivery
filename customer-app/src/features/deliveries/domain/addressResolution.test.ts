import { describe, expect, it } from 'vitest';

import { confirmMapPin, resolveManualAddress, typedHouseNumber } from './addressResolution';
import type { PlaceSuggestion } from './placeSuggestion';

const street: PlaceSuggestion = {
  label: '66 Mungongoma Road, Mufakose, Harare, Zimbabwe',
  latitude: '-17.8900000',
  longitude: '30.9600000',
  exact: true,
  placeId: 'ChIJstreet0001',
};

const suburb: PlaceSuggestion = {
  label: 'Mufakose, Harare, Zimbabwe',
  latitude: '-17.9000000',
  longitude: '30.9500000',
  exact: false,
  placeId: 'ChIJsuburb0001',
};

const devicePoint = { latitude: '-17.8910000', longitude: '30.9610000' };

describe('resolveManualAddress', () => {
  it('uses a Geoapify street match and ignores the phone lookup', () => {
    expect(resolveManualAddress('66 Mungongoma Road', [suburb, street], devicePoint)).toEqual({
      status: 'resolved',
      location: {
        label: '66 Mungongoma Road, Mufakose, Harare',
        latitude: street.latitude,
        longitude: street.longitude,
        provider: 'google_places',
        placeId: 'ChIJstreet0001',
        precision: 'exact',
      },
    });
  });

  it('uses the phone lookup when Geoapify has no results', () => {
    expect(resolveManualAddress('66 Mungongoma Road', [], devicePoint)).toEqual({
      status: 'confirm-pin',
      location: {
        label: '66 Mungongoma Road',
        latitude: devicePoint.latitude,
        longitude: devicePoint.longitude,
        provider: 'device',
        placeId: null,
        precision: 'unverified',
      },
    });
  });

  it('does not turn a suburb match into the selected street', () => {
    expect(resolveManualAddress('66 Mungongoma Road', [suburb], null)).toEqual({
      status: 'choose-area',
      areas: [suburb],
    });
  });

  it('fails when neither provider resolves the address', () => {
    expect(resolveManualAddress('66 Mungongoma Road', [], null)).toEqual({ status: 'unresolved' });
  });
});

describe('typedHouseNumber', () => {
  it('keeps an exact match number and uses the typed address when none was found', () => {
    expect(typedHouseNumber('66 Mungongoma Road', 'exact')).toBe('');
    expect(typedHouseNumber('  66   Mungongoma Road ', 'area')).toBe('66 Mungongoma Road');
    expect(typedHouseNumber('66 Mungongoma Road', 'unverified')).toBe('66 Mungongoma Road');
  });
});

describe('confirmMapPin', () => {
  it('keeps an area pin approximate until the customer confirms it', () => {
    expect(confirmMapPin(suburb)).toEqual({
      label: 'Mufakose, Harare',
      latitude: suburb.latitude,
      longitude: suburb.longitude,
      provider: 'google_places',
      placeId: 'ChIJsuburb0001',
      precision: 'area',
    });
  });
});
