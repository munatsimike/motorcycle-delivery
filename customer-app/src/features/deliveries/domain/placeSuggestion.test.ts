import { describe, expect, it } from 'vitest';

import { readPlaceSuggestions } from './placeSuggestion';

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

  it('rejects a response that is not a suggestion list', () => {
    expect(() => readPlaceSuggestions({})).toThrow('Address suggestions are unavailable.');
  });
});
