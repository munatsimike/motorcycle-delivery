import assert from 'node:assert/strict';
import test from 'node:test';
import type { CustomerAccount } from '../auth/contracts.ts';
import { clearStoredProfile, readStoredProfile, storeProfileAccount, storeProfilePhoto } from './profileLoad.ts';

const account: CustomerAccount = {
  id: 'customer-1',
  kind: 'INDIVIDUAL',
  name: 'Tariro Moyo',
  contactName: null,
  phone: 'phone',
  address: '',
  email: null,
  hasProfilePhoto: true,
  marketplaceEnabled: true,
};

test('profile paints before the photo and reuses it on the next visit', () => {
  clearStoredProfile();
  const first = storeProfileAccount(account);
  assert.equal(first.fetchPhoto, true);
  assert.equal(first.photoUrl, null);
  assert.equal(readStoredProfile()?.account.name, 'Tariro Moyo');

  storeProfilePhoto(account.id, 'blob:photo');
  const again = storeProfileAccount({ ...account, name: 'Tariro Moyo' });
  assert.equal(again.fetchPhoto, false);
  assert.equal(again.photoUrl, 'blob:photo');
  clearStoredProfile();
});

test('a missing or failed profile photo keeps the placeholder', () => {
  clearStoredProfile();
  assert.equal(storeProfileAccount({ ...account, hasProfilePhoto: false }).fetchPhoto, false);
  const withPhoto = storeProfileAccount(account);
  assert.equal(withPhoto.fetchPhoto, true);
  storeProfilePhoto(account.id, null);
  const failed = storeProfileAccount(account);
  assert.equal(failed.fetchPhoto, false);
  assert.equal(failed.photoUrl, null);
  clearStoredProfile();
  assert.equal(readStoredProfile(), null);
});
