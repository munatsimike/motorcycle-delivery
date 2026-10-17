import { describe, expect, it } from 'vitest';

import { readAvailabilityResponse } from './availabilityResponse';

describe('availability response', () => {
  it('reads the server availability and optional message', () => {
    expect(readAvailabilityResponse({ availability: 'AVAILABLE' })).toEqual({
      availability: 'AVAILABLE',
      message: null,
    });
    expect(readAvailabilityResponse({
      availability: 'OFFLINE',
      eligible: false,
      message: 'Rider is no longer eligible to be online',
    })).toEqual({
      availability: 'OFFLINE',
      message: 'Rider is no longer eligible to be online',
    });
  });

  it('rejects a payload that is not an availability state', () => {
    expect(() => readAvailabilityResponse({ availability: 'ONLINE' })).toThrow(
      'Availability could not be updated.',
    );
  });
});
