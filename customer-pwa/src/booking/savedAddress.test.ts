import assert from 'node:assert/strict';
import test from 'node:test';
import { clearStopLocation, emptyStop, hasSelectedCoordinates } from './draft.ts';
import {
  automaticGpsMayApply,
  bookingSaveBody,
  bookingSaveLabel,
  emptyAddressList,
  isRebookState,
  readSavedAddresses,
  filterSavedAddresses,
  savedAddressLabel,
  saveRequest,
  skipsPlacesLookup,
  stopFromSavedAddress,
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

test('saved address search matches name, address, phone, and label without case or extra spaces', () => {
  assert.deepEqual(filterSavedAddresses([home, office], '   ').map((entry) => entry.id), ['home', 'office']);
  assert.deepEqual(filterSavedAddresses([home, office], '  TENDAI   moyo ').map((entry) => entry.id), ['home']);
  assert.deepEqual(filterSavedAddresses([home, office], 'nelson   mandela').map((entry) => entry.id), ['office']);
  assert.deepEqual(filterSavedAddresses([home, office], '+263 77 222').map((entry) => entry.id), ['office']);
  assert.deepEqual(filterSavedAddresses([home, office], 'WORK').map((entry) => entry.id), ['office']);
  assert.deepEqual(filterSavedAddresses([home, office], 'home').map((entry) => entry.id), ['home']);
  assert.deepEqual(filterSavedAddresses([home, office], 'airport'), []);
});

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

test('a typed or rebooked pickup is not treated as an empty address', () => {
  assert.equal(isRebookState({ rebook: {} }), true);
  assert.equal(isRebookState({}), false);
});

test('automatic GPS stays off after the customer edits the pickup', () => {
  const chosen = stopFromSavedAddress(emptyStop(), office);
  assert.equal(automaticGpsMayApply({ addressEdited: true, pickup: chosen }), false);
  assert.equal(automaticGpsMayApply({ addressEdited: false, pickup: emptyStop() }), true);
  assert.equal(automaticGpsMayApply({ addressEdited: false, pickup: chosen }), false);
});

test('saving waits for a successful booking and keeps Home and Work', () => {
  assert.equal(saveRequest(null, { label: 'HOME' }), null);
  assert.equal(saveRequest(bookedStop, { label: null }), null);
  assert.equal(bookingSaveLabel({ label: null }), null);

  const pickup = saveRequest(bookedStop, { label: 'HOME' });
  const delivery = saveRequest({ ...bookedStop, address: '12 Samora' }, { label: 'WORK' });
  assert.equal(pickup?.label, 'HOME');
  assert.equal(pickup?.customLabel, null);
  assert.equal(pickup?.placeId, 'ChIJoffice1');
  assert.equal(pickup?.coordinateSource, 'GOOGLE_PLACES');
  assert.equal(pickup?.contactName, 'Rudo Ncube');
  assert.equal(pickup?.isDefaultPickup, false);
  assert.equal(pickup?.reuseExisting, true);
  assert.equal(delivery?.label, 'WORK');
  assert.equal(delivery?.customLabel, null);
  assert.notEqual(delivery?.address, pickup?.address);
  assert.equal(bookingSaveLabel({ label: 'WORK' })?.label, 'WORK');

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

test('deleting an address removes only that row', () => {
  const shop: SavedAddress = { ...home, id: 'shop', label: 'CUSTOM', customLabel: 'Shop', isDefaultPickup: false };
  assert.deepEqual(withoutSavedAddress([home, shop], 'home').map((entry) => entry.id), ['shop']);
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
