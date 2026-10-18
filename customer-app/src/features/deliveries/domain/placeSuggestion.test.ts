import { describe, expect, it } from 'vitest';

import { readPlaceSuggestions, readResolvedPlace, selectedAddressLabel } from './placeSuggestion';

describe('readPlaceSuggestions', () => {
  it('keeps an exact street and an area match', () => {
    expect(readPlaceSuggestions({
      suggestions: [
        {
          label: '66 Mungongoma Road, Mufakose, Harare, Zimbabwe',
          latitude: -17.89,
          longitude: 30.96,
          exact: true,
        },
        {
          label: 'Mufakose, Harare, Zimbabwe',
          latitude: -17.9,
          longitude: 30.95,
          exact: false,
        },
      ],
    })).toEqual([
      {
        label: '66 Mungongoma Road, Mufakose, Harare, Zimbabwe',
        latitude: '-17.8900000',
        longitude: '30.9600000',
        exact: true,
      },
      {
        label: 'Mufakose, Harare, Zimbabwe',
        latitude: '-17.9000000',
        longitude: '30.9500000',
        exact: false,
      },
    ]);
  });

  it('keeps a prediction that still needs place details', () => {
    expect(readPlaceSuggestions({
      suggestions: [
        { label: 'Budiriro, Harare', exact: false, placeId: 'ChIJsuburb0001' },
      ],
    })).toEqual([
      {
        label: 'Budiriro, Harare',
        latitude: '',
        longitude: '',
        exact: false,
        placeId: 'ChIJsuburb0001',
      },
    ]);
  });

  it('keeps the house number and suburb and leaves out the city', () => {
    expect(selectedAddressLabel('66 Mungongoma Road, Mufakose, Harare', {
      suburb: 'Mufakose',
      locality: 'Harare',
    })).toBe('66 Mungongoma Road, Mufakose');
    expect(selectedAddressLabel('Budiriro, Harare', {
      suburb: 'Budiriro',
      locality: 'Harare',
    })).toBe('Budiriro');
    expect(selectedAddressLabel('Samora Machel Avenue West, Harare', {
      suburb: 'Harare Central',
      locality: 'Harare',
    })).toBe('Samora Machel Avenue West, Harare Central');
    expect(selectedAddressLabel('Norton', { locality: 'Norton' })).toBe('Norton');
  });

  it('reads the suburb returned with place details', () => {
    expect(readResolvedPlace({
      label: 'Mungongoma Road, Mufakose',
      latitude: -17.89,
      longitude: 30.96,
      suburb: 'Mufakose',
      locality: 'Harare',
    })).toMatchObject({
      label: 'Mungongoma Road, Mufakose',
      suburb: 'Mufakose',
      locality: 'Harare',
    });
  });

  it('rejects a response that is not a suggestion list', () => {
    expect(() => readPlaceSuggestions({})).toThrow('Address suggestions are unavailable.');
  });
});
