import { describe, expect, it } from 'vitest';

import { readCustomerAccount } from './customerAccount';

describe('readCustomerAccount', () => {
  it('reads an individual account', () => {
    expect(readCustomerAccount({
      id: 'account-1',
      kind: 'INDIVIDUAL',
      name: 'Rudo Ncube',
      contactName: null,
      address: '1 First Street',
      phone: '+263771234567',
    })).toEqual({
      id: 'account-1',
      kind: 'INDIVIDUAL',
      name: 'Rudo Ncube',
      contactName: null,
      address: '1 First Street',
      phone: '+263771234567',
      email: null,
      photoUrl: null,
    });
  });

  it('reads a business account', () => {
    expect(readCustomerAccount({
      kind: 'BUSINESS',
      name: 'Moyo Deliveries',
      contactName: 'Tendai Moyo',
      address: '12 Samora Machel Avenue',
      phone: '+263771234567',
    })).toMatchObject({
      kind: 'BUSINESS',
      contactName: 'Tendai Moyo',
    });
  });

  it('keeps an optional profile photo and treats a removed photo as absent', () => {
    expect(readCustomerAccount({
      id: 'account-2',
      kind: 'INDIVIDUAL',
      name: 'Rudo Ncube',
      contactName: null,
      address: '1 First Street',
      phone: '+263771234567',
      photoUrl: ' https://example.com/rudo.jpg ',
    }).photoUrl).toBe('https://example.com/rudo.jpg');

    expect(readCustomerAccount({
      kind: 'INDIVIDUAL',
      name: 'Rudo Ncube',
      contactName: null,
      address: '1 First Street',
      phone: '+263771234567',
      photoUrl: '   ',
    }).photoUrl).toBeNull();
  });

  it('reads an optional email and ignores a missing one', () => {
    expect(readCustomerAccount({
      kind: 'INDIVIDUAL',
      name: 'Rudo Ncube',
      contactName: null,
      address: '1 First Street',
      phone: '+263771234567',
      email: ' Rudo@Example.com ',
    }).email).toBe('Rudo@Example.com');

    expect(readCustomerAccount({
      kind: 'INDIVIDUAL',
      name: 'Rudo Ncube',
      contactName: null,
      address: '1 First Street',
      phone: '+263771234567',
    }).email).toBeNull();
  });

  it('rejects a response that is missing account fields', () => {
    expect(() => readCustomerAccount({ kind: 'INDIVIDUAL' })).toThrow('Account details are unavailable.');
  });
});
