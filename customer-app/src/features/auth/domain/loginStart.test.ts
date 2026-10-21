import { describe, expect, it } from 'vitest';

import { readLoginStart } from './loginStart';

describe('customer login start', () => {
  it('keeps a code request free of account details', () => {
    expect(readLoginStart({ status: 'pending', fullName: 'Tendai Moyo' })).toEqual({ status: 'pending' });
  });

  it('uses the same unavailable result for a missing customer account', () => {
    expect(readLoginStart({
      status: 'unavailable',
      fullName: 'Tendai Moyo',
      phone: '+263771234567',
      address: '1 First Street',
    })).toEqual({ status: 'unavailable' });
  });
});
