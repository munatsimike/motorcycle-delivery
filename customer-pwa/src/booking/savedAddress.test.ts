import assert from 'node:assert/strict';
import test from 'node:test';
import { clearStopLocation, emptyStop, hasSelectedCoordinates } from './draft.ts';
import {
  applyDefaultPickup,
  automaticGpsMayApply,
  bookingSaveBody,
  bookingSaveLabel,
  canApplyDefaultPickup,
  emptyAddressList,
  isRebookState,
  readSavedAddresses,
  savedAddressLabel,
  saveRequest,
  skipsPlacesLookup,
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
  placeId: null,
  coordinateSource: 'DEVICE_GEOCODER',
  contactName: 'Tendai Moyo',
  contactPhone: '+263771234567',
  isDefaultPickup: true,
};

const office: SavedAddress = {
  id: 'office',
  label: 'WORK',
  customLabel: null,
  address: '44 Nelson Mandela',
  latitude: '-17.8210000',
  longitude: '31.0400000',
  placeId: 'ChIJoffice1',
  coordinateSource: 'GOOGLE_PLACES',
  contactName: 'Rudo Ncube',
  contactPhone: '+263772222222',
  isDefaultPickup: false,
};

const bookedStop = {
  address: '44 Nelson Mandela',
  latitude: -17.821,
  longitude: 31.04,
  contactName: 'Rudo Ncube',
  contactPhone: '+263772222222',
  placeId: 'ChIJoffice1',
  coordinateSource: 'GOOGLE_PLACES' as const,
};

test('an empty address book offers add address', () => {
  assert.equal(emptyAddressList([]), true);
  assert.equal(emptyAddressList([home]), false);
  assert.equal(savedAddressLabel(home), 'Home');
  assert.equal(savedAddressLabel({ label: 'WORK', customLabel: null }), 'Work');
  assert.equal(savedAddressLabel({ label: 'CUSTOM', customLabel: 'Mum' }), 'Mum');
});

test('saved pickup and drop-off keep coordinates, contacts, and a Google Place ID', () => {
  const pickup = stopFromSavedAddress({ ...emptyStop(), landmark: 'Blue gate', instructions: 'Call on arrival' }, home);
  assert.equal(pickup.address, '12 Samora');
  assert.equal(pickup.latitude, '-17.8292000');
  assert.equal(pickup.longitude, '31.0522000');
  assert.equal(pickup.contactName, 'Tendai Moyo');
  assert.equal(pickup.contactPhone, '+263771234567');
  assert.equal(pickup.placeId, null);
  assert.equal(pickup.coordinateSource, 'DEVICE_GEOCODER');
  assert.equal(pickup.landmark, 'Blue gate');
  assert.equal(skipsPlacesLookup(pickup), true);

  const dropoff = stopFromSavedAddress(emptyStop(), office);
  assert.equal(dropoff.address, '44 Nelson Mandela');
  assert.equal(dropoff.latitude, '-17.8210000');
  assert.equal(dropoff.longitude, '31.0400000');
  assert.equal(dropoff.contactName, 'Rudo Ncube');
  assert.equal(dropoff.contactPhone, '+263772222222');
  assert.equal(dropoff.placeId, 'ChIJoffice1');
  assert.equal(dropoff.coordinateSource, 'GOOGLE_PLACES');
  assert.equal(skipsPlacesLookup(dropoff), true);
  assert.equal(skipsPlacesLookup(emptyStop()), false);
});

test('changing address text clears stale coordinates and the Place ID', () => {
  const selected = stopFromSavedAddress(emptyStop(), office);
  const cleared = { ...selected, ...clearStopLocation('New road') };
  assert.equal(cleared.address, 'New road');
  assert.equal(cleared.latitude, '');
  assert.equal(cleared.longitude, '');
  assert.equal(cleared.placeId, null);
  assert.equal(cleared.coordinateSource, null);
  assert.equal(hasSelectedCoordinates(cleared), false);
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

test('a default pickup wins over a late automatic GPS fix, and a manual choice stays put', () => {
  const applied = applyDefaultPickup({ rebook: false, pickup: emptyStop(), saved: [office, home] });
  assert.equal(applied.applied, true);
  assert.equal(applied.pickup.address, home.address);
  assert.equal(applied.pickup.contactPhone, home.contactPhone);
  assert.equal(automaticGpsMayApply({ addressEdited: applied.applied, pickup: applied.pickup }), false);

  const chosen = stopFromSavedAddress(emptyStop(), office);
  assert.equal(automaticGpsMayApply({ addressEdited: true, pickup: chosen }), false);
  assert.equal(automaticGpsMayApply({ addressEdited: false, pickup: emptyStop() }), true);
  assert.equal(applyDefaultPickup({ rebook: false, pickup: chosen, saved: [home] }).applied, false);
});

test('saving waits for a successful booking and keeps Home, Work, and Custom independent', () => {
  assert.equal(saveRequest(null, { label: 'HOME', customLabel: '' }), null);
  assert.equal(saveRequest(bookedStop, { label: null, customLabel: '' }), null);
  assert.equal(bookingSaveLabel({ label: 'CUSTOM', customLabel: '   ' }), null);

  const pickup = saveRequest(bookedStop, { label: 'HOME', customLabel: 'ignored' });
  const delivery = saveRequest({ ...bookedStop, address: '12 Samora' }, { label: 'CUSTOM', customLabel: 'Mum' });
  assert.equal(pickup?.label, 'HOME');
  assert.equal(pickup?.customLabel, null);
  assert.equal(pickup?.placeId, 'ChIJoffice1');
  assert.equal(pickup?.coordinateSource, 'GOOGLE_PLACES');
  assert.equal(pickup?.contactName, 'Rudo Ncube');
  assert.equal(pickup?.reuseExisting, true);
  assert.equal(delivery?.label, 'CUSTOM');
  assert.equal(delivery?.customLabel, 'Mum');
  assert.notEqual(delivery?.address, pickup?.address);
  assert.equal(bookingSaveLabel({ label: 'WORK', customLabel: '' })?.label, 'WORK');

  const device = bookingSaveBody({
    ...bookedStop,
    placeId: null,
    coordinateSource: 'DEVICE_GEOCODER',
  }, { label: 'WORK', customLabel: null });
  assert.equal(device.placeId, null);
  assert.equal(device.coordinateSource, 'DEVICE_GEOCODER');
  assert.equal(device.reuseExisting, true);
  assert.deepEqual(bookingSaveBody({
    ...bookedStop,
    placeId: null,
    coordinateSource: 'DEVICE_GEOCODER',
  }, { label: 'WORK', customLabel: null }), device);
});

test('edit, delete, and default pickup stay on the owned list', () => {
  const shop: SavedAddress = { ...home, id: 'shop', label: 'CUSTOM', customLabel: 'Shop', isDefaultPickup: false };
  assert.deepEqual(withoutSavedAddress([home, shop], 'home').map((entry) => entry.id), ['shop']);
  assert.deepEqual(withDefaultPickup([home, shop], 'shop').map((entry) => entry.isDefaultPickup), [false, true]);
});

test('one invalid saved address is skipped and the valid addresses remain', () => {
  assert.throws(() => readSavedAddresses({ id: 'home' }), /Saved addresses are unavailable/);
  const [read, google] = readSavedAddresses([
    home,
    { id: 'broken', label: 'HOME', address: 'Missing point', contactName: 'Tendai Moyo', contactPhone: '+263771234567', isDefaultPickup: false },
    { ...office, customLabel: null },
    { id: 'mismatch', label: 'HOME', address: 'Bad source', latitude: '-17.8', longitude: '31.0', placeId: 'ChIJoffice1', coordinateSource: 'DEVICE_GEOCODER', contactName: 'Tendai Moyo', contactPhone: '+263771234567', isDefaultPickup: false },
  ]);
  assert.equal(read?.contactName, 'Tendai Moyo');
  assert.equal(read?.coordinateSource, 'DEVICE_GEOCODER');
  assert.equal(google?.placeId, 'ChIJoffice1');
  assert.equal(google?.coordinateSource, 'GOOGLE_PLACES');
  assert.equal(emptyAddressList(readSavedAddresses([
    { id: 'broken', address: 'No coordinates' },
  ])), true);
});
