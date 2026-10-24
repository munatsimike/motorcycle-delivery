import { describe, expect, it } from 'vitest';

import type { CustomerAccount } from './customerAccount';
import { profileEditChange, profileEditErrors, profileFullName } from './profileEdit';

const individual: CustomerAccount = {
  id: 'account-1',
  kind: 'INDIVIDUAL',
  name: 'Rudo Ncube',
  contactName: null,
  address: '1 First Street',
  phone: '+263771234567',
  email: null,
  photoUrl: null,
  marketplaceEnabled: false,
};

describe('profileEdit', () => {
  it('uses the contact name for a business account', () => {
    expect(profileFullName({ ...individual, kind: 'BUSINESS', name: 'Moyo Deliveries', contactName: 'Tendai Moyo' }))
      .toBe('Tendai Moyo');
  });

  it('rejects an empty name and an empty address', () => {
    expect(profileEditErrors({ fullName: '   ', address: '   ' })).toEqual({
      fullName: 'Full name is required.',
      address: 'Address is required.',
    });
    expect(profileEditChange({ fullName: ' ', address: '' }, individual)).toBeNull();
  });

  it('ignores an unchanged profile and returns a trimmed address', () => {
    expect(profileEditChange({ fullName: 'Rudo Ncube', address: '1 First Street' }, individual)).toBeNull();
    expect(profileEditChange({ fullName: '  Chipo   Dube ', address: '  12   Samora Machel Avenue ' }, individual)).toEqual({
      fullName: 'Chipo Dube',
      email: null,
      address: '12 Samora Machel Avenue',
    });
  });
});
