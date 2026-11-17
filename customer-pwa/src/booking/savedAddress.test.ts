import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyStop } from './draft.ts';
import {
  bookingSaveBody,
  canApplyDefaultPickup,
  emptyAddressList,
  isRebookState,
  readSavedAddresses,
  savedAddressLabel,
  stopFromSavedAddress,
  withDefaultPickup,
  withoutSavedAddress,
  type SavedAddress,
} from './savedAddress.ts';

const home: SavedAddress = {
  id: 'home',
  label: 'HOME',
  customLabel: null,
  address: '12 Samora',
  latitude: '-17.8292000',
  longitude: '31.0522000',
  contactName: 'Tendai Moyo',
  contactPhone: '+263771234567',
  isDefaultPickup: true,
};

test('an empty address book offers add address', () => {
  assert.equal(emptyAddressList([]), true);
  assert.equal(emptyAddressList([home]), false);
  assert.equal(savedAddressLabel(home), 'Home');
  assert.equal(savedAddressLabel({ label: 'WORK', customLabel: null }), 'Work');
  assert.equal(savedAddressLabel({ label: 'CUSTOM', customLabel: 'Mum' }), 'Mum');
});

test('choosing a saved address fills the stop without a place id', () => {
  const current = { ...emptyStop(), landmark: 'Blue gate', instructions: 'Call on arrival', contactName: 'Typed' };
  const next = stopFromSavedAddress(current, home);
  assert.equal(next.address, '12 Samora');
  assert.equal(next.latitude, '-17.8292000');
  assert.equal(next.longitude, '31.0522000');
  assert.equal(next.contactName, 'Tendai Moyo');
  assert.equal(next.contactPhone, '+263771234567');
  assert.equal(next.placeId, null);
  assert.equal(next.coordinateSource, 'DEVICE_GEOCODER');
  assert.equal(next.landmark, 'Blue gate');
  assert.equal(next.instructions, 'Call on arrival');
});

test('the default pickup does not replace a rebook or a pickup the customer already entered', () => {
  const empty = emptyStop();
  assert.equal(canApplyDefaultPickup({ rebook: false, pickup: empty }), true);
  assert.equal(canApplyDefaultPickup({ rebook: true, pickup: empty }), false);
  assert.equal(canApplyDefaultPickup({
    rebook: false,
    pickup: { ...empty, address: 'Typed road' },
  }), false);
  assert.equal(isRebookState({ rebook: {} }), true);
  assert.equal(isRebookState({}), false);
});

test('saving after booking is optional and a repeat uses the same stop', () => {
  const body = bookingSaveBody({
    address: '12 Samora',
    latitude: -17.8292,
    longitude: 31.0522,
    contactName: 'Tendai Moyo',
    contactPhone: '+263771234567',
  }, 'Pickup');
  assert.equal(body.reuseExisting, true);
  assert.equal(body.placeId, null);
  assert.equal(body.coordinateSource, 'DEVICE_GEOCODER');
  assert.equal(body.isDefaultPickup, false);
  assert.equal(body.latitude, '-17.8292000');
  const again = bookingSaveBody({
    address: '12 Samora',
    latitude: -17.8292,
    longitude: 31.0522,
    contactName: 'Tendai Moyo',
    contactPhone: '+263771234567',
  }, 'Pickup');
  assert.deepEqual(again, body);
});

test('edit, delete, and default pickup stay on the owned list', () => {
  const shop: SavedAddress = { ...home, id: 'shop', label: 'CUSTOM', customLabel: 'Shop', isDefaultPickup: false };
  assert.deepEqual(withoutSavedAddress([home, shop], 'home').map((entry) => entry.id), ['shop']);
  assert.deepEqual(withDefaultPickup([home, shop], 'shop').map((entry) => entry.isDefaultPickup), [false, true]);
});

test('a saved-address response that is not a list is an error', () => {
  assert.throws(() => readSavedAddresses({ id: 'home' }), /Saved addresses are unavailable/);
  const [read] = readSavedAddresses([home]);
  assert.equal(read?.contactName, 'Tendai Moyo');
});
