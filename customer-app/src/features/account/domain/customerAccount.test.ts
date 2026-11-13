import { describe, expect, it } from 'vitest';

import { bookingMode, nextMarketplaceSignal, readCustomerAccount } from './customerAccount';

describe('readCustomerAccount', () => {
  it('reads an individual account', () => {
    expect(readCustomerAccount({
      id: 'account-1',
      kind: 'INDIVIDUAL',
      name: 'Rudo Ncube',
      contactName: null,
      address: '1 First Street',
      phone: '+263771234567',
      marketplaceEnabled: true,
    })).toEqual({
      id: 'account-1',
      kind: 'INDIVIDUAL',
      name: 'Rudo Ncube',
      contactName: null,
      address: '1 First Street',
      phone: '+263771234567',
      email: null,
      photoUrl: null,
      hasProfilePhoto: false,
      marketplaceEnabled: true,
    });
  });

  it('reads a business account', () => {
    expect(readCustomerAccount({
      kind: 'BUSINESS',
      name: 'Moyo Deliveries',
      contactName: 'Tendai Moyo',
      address: '12 Samora Machel Avenue',
      phone: '+263771234567',
      marketplaceEnabled: false,
    })).toMatchObject({
      kind: 'BUSINESS',
      contactName: 'Tendai Moyo',
      marketplaceEnabled: false,
    });
  });

  it('reads a stored profile photo flag and ignores a public photo url', () => {
    const saved = readCustomerAccount({
      id: 'account-2',
      kind: 'INDIVIDUAL',
      name: 'Rudo Ncube',
      contactName: null,
      address: '1 First Street',
      phone: '+263771234567',
      marketplaceEnabled: false,
      hasProfilePhoto: true,
      photoUrl: ' https://example.com/rudo.jpg ',
    });
    expect(saved.hasProfilePhoto).toBe(true);
    expect(saved.photoUrl).toBeNull();
    expect(JSON.stringify(saved)).not.toContain('example.com');

    expect(readCustomerAccount({
      kind: 'INDIVIDUAL',
      name: 'Rudo Ncube',
      contactName: null,
      address: '1 First Street',
      phone: '+263771234567',
      marketplaceEnabled: false,
    }).hasProfilePhoto).toBe(false);
  });

  it('reads an optional email and ignores a missing one', () => {
    expect(readCustomerAccount({
      kind: 'INDIVIDUAL',
      name: 'Rudo Ncube',
      contactName: null,
      address: '1 First Street',
      phone: '+263771234567',
      marketplaceEnabled: false,
      email: ' Rudo@Example.com ',
    }).email).toBe('Rudo@Example.com');

    expect(readCustomerAccount({
      kind: 'INDIVIDUAL',
      name: 'Rudo Ncube',
      contactName: null,
      address: '1 First Street',
      phone: '+263771234567',
      marketplaceEnabled: false,
    }).email).toBeNull();
  });

  it('rejects a response that is missing account fields', () => {
    expect(() => readCustomerAccount({ kind: 'INDIVIDUAL' })).toThrow('Account details are unavailable.');
  });

  it('keeps a missing marketplace flag separate from a disabled marketplace', () => {
    expect(() => readCustomerAccount({
      kind: 'INDIVIDUAL',
      name: 'Rudo Ncube',
      contactName: null,
      address: '1 First Street',
      phone: '+263771234567',
    })).toThrow('Account details are unavailable.');
    expect(bookingMode(true)).toBe('v2');
    expect(bookingMode(false)).toBe('unavailable');
    expect(bookingMode(null)).toBe('unknown');
  });

  it('keeps the known marketplace mode when the profile request fails', () => {
    expect(nextMarketplaceSignal(true, { type: 'network' })).toBe(true);
    expect(nextMarketplaceSignal(false, { type: 'authentication' })).toBe(false);
    expect(nextMarketplaceSignal(null, { type: 'network' })).toBeNull();
    expect(nextMarketplaceSignal(null, { type: 'loaded', enabled: false })).toBe(false);
    expect(nextMarketplaceSignal(false, { type: 'loaded', enabled: true })).toBe(true);
  });
});
