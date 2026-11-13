import assert from 'node:assert/strict';
import test from 'node:test';
import { customerOfferForBooking, offerFieldText } from '../deliveries/tracking.ts';
import {
  applyResolvedStop,
  deliveryContactPhone,
  emptyBookingDraft,
  emptyStop,
  parcelError,
  prepareBooking,
  quoteIdentity,
  selectParcelContent,
  stopEntryError,
  v2CreateBody,
} from './draft.ts';
import {
  bookingBackAction,
  bookingKeyFor,
  persistentAttemptStore,
  bookingMode,
  bookingNavigationDelay,
  canStartBookingSubmit,
  clearBookingAttempt,
  memoryAttemptStore,
} from './flow.ts';
import { acceptSearchResult, pickupAutofillFix, resolveManualAddress } from './places.ts';
import { bookingSuccessPath, confirmQuoteDecision, nextCustomerOffer, quotesMatch, readDeliveryQuote } from './quote.ts';

test('pickup and drop-off require an address, contact, phone, and resolved point', () => {
  const stop = emptyStop();
  assert.equal(stopEntryError(stop, 'pickup'), 'Enter the pickup address');
  stop.address = '12 Samora Machel';
  assert.equal(stopEntryError(stop, 'drop-off'), 'Enter the drop-off contact name');
  stop.contactName = 'Tariro';
  assert.equal(stopEntryError(stop, 'drop-off'), 'Enter the drop-off contact phone');
  stop.contactPhone = '771234567';
  assert.equal(stopEntryError(stop, 'drop-off'), null);
  const draft = emptyBookingDraft();
  draft.dropoff = { ...stop, coordinateSource: 'GOOGLE_PLACES', placeId: null, latitude: '-17.8', longitude: '31.0' };
  draft.pickup = { ...stop, coordinateSource: 'GOOGLE_PLACES', placeId: 'place-1', latitude: '-17.8', longitude: '31.0' };
  assert.equal(prepareBooking(draft).ok, false);
});

test('Zimbabwe and Dutch mobile numbers follow the native rules', () => {
  assert.equal(deliveryContactPhone('0771234567'), '+263771234567');
  assert.equal(deliveryContactPhone('+263771234567'), '+263771234567');
  assert.equal(deliveryContactPhone('0612345678'), '+31612345678');
  assert.equal(deliveryContactPhone('+31612345678'), '+31612345678');
  assert.equal(deliveryContactPhone('12345'), null);
});

test('address resolution keeps exact places and ignores a stale search', () => {
  const exact = resolveManualAddress('12 Samora', [{
    label: '12 Samora Machel, Harare, Zimbabwe',
    latitude: '-17.8292000',
    longitude: '31.0522000',
    exact: true,
    placeId: 'place-1',
  }], null);
  assert.equal(exact.status, 'resolved');
  const areas = resolveManualAddress('Unknown street', [{
    label: 'Harare',
    latitude: '-17.8000000',
    longitude: '31.0000000',
    exact: false,
  }], null);
  assert.equal(areas.status, 'choose-area');
  assert.equal(resolveManualAddress('Nowhere', [], null).status, 'unresolved');
  assert.equal(acceptSearchResult(1, 2, ['stale']), null);
  assert.deepEqual(acceptSearchResult(2, 2, ['current']), ['current']);
});

test('parcel selection stays small and offer validation uses the booking limits', () => {
  const selected = selectParcelContent('Food');
  assert.deepEqual(selected, { description: 'Food', size: 'SMALL' });
  const draft = { ...emptyBookingDraft(), ...selected, serviceClass: null };
  assert.equal(parcelError(draft), 'Choose Urgent or Flexible');
  assert.equal(offerFieldText('12.345'), '12.34');
  assert.deepEqual(customerOfferForBooking('4.5'), { offeredPrice: '4.50' });
  assert.equal('error' in customerOfferForBooking('0'), true);
  assert.equal('error' in customerOfferForBooking('1000.01'), true);
});

test('a quote stays valid only for the same pickup, drop-off, and service class', () => {
  const quote = readDeliveryQuote({
    distanceMeters: 1200,
    pricingVersion: 3,
    currency: 'USD',
    suggestedPrice: '4.50',
    serviceClass: 'FLEXIBLE',
  });
  const first = quoteIdentity('-17.8,31|-17.9,31.1', 'FLEXIBLE');
  const moved = quoteIdentity('-17.7,31|-17.9,31.1', 'FLEXIBLE');
  assert.notEqual(first, moved);
  assert.equal(quotesMatch(quote, { ...quote, suggestedPrice: '5.00' }), false);
  const kept = nextCustomerOffer({ current: '6.00', edited: true, previousPinKey: first, pinKey: first, suggestedPrice: '4.50' });
  assert.equal(kept.text, '6.00');
  const reset = nextCustomerOffer({ current: '6.00', edited: true, previousPinKey: first, pinKey: moved, suggestedPrice: '5.00' });
  assert.equal(reset.text, '5.00');
  assert.equal(reset.edited, false);
});

test('a changed price requires another confirmation and the same body reuses its key', () => {
  const shown = readDeliveryQuote({ distanceMeters: 800, pricingVersion: 2, currency: 'USD', suggestedPrice: '3.00', serviceClass: 'EXPRESS' });
  const fresh = { ...shown, suggestedPrice: '3.40', pricingVersion: 4 };
  const decision = confirmQuoteDecision({ shown, fresh, shownIdentity: 'pin|EXPRESS', identity: 'pin|EXPRESS', offerText: '3.00' });
  assert.deepEqual(decision, { action: 'review', message: 'The price changed. Review the new price and confirm again.' });
  const store = memoryAttemptStore();
  const body = JSON.stringify({ offeredPrice: '3.00' });
  const first = bookingKeyFor(store, body, () => 'key-1');
  const retry = bookingKeyFor(store, body, () => 'key-2');
  assert.equal(first, 'key-1');
  assert.equal(retry, 'key-1');
  clearBookingAttempt(store);
  assert.equal(bookingKeyFor(store, body, () => 'key-3'), 'key-3');
  assert.equal(bookingKeyFor(store, JSON.stringify({ offeredPrice: '4.00' }), () => 'key-4'), 'key-4');
  const saved = new Map<string, string>();
  const firstVisit = persistentAttemptStore(mapStorage(saved), 'customer_delivery_create_v1');
  assert.equal(bookingKeyFor(firstVisit, body, () => 'kept'), 'kept');
  const restarted = persistentAttemptStore(mapStorage(saved), 'customer_delivery_create_v1');
  assert.equal(bookingKeyFor(restarted, body, () => 'other'), 'kept');
  assert.equal(bookingKeyFor(restarted, JSON.stringify({ offeredPrice: '9.00' }), () => 'fresh'), 'fresh');
  clearBookingAttempt(restarted);
  assert.equal(saved.has('customer_delivery_create_v1'), false);
});

test('confirmation cannot start twice and eligibility must be explicit', () => {
  assert.equal(canStartBookingSubmit(false, null), true);
  assert.equal(canStartBookingSubmit(true, null), false);
  assert.equal(canStartBookingSubmit(false, 'create'), false);
  assert.equal(bookingBackAction('destination', 'quote'), 'blocked');
  assert.equal(bookingBackAction('pickup', null), 'exit');
  assert.equal(bookingBackAction('parcel', null), 'previous');
  assert.equal(bookingMode(null), 'unknown');
  assert.equal(bookingMode(false), 'unavailable');
  assert.equal(bookingMode(true), 'v2');
  assert.equal(bookingNavigationDelay(false), 380);
  assert.equal(bookingNavigationDelay(true), 0);
  assert.equal(bookingSuccessPath('delivery 1'), '/deliveries/delivery%201');
});

test('pickup autofill accepts only a granted, fresh, accurate Zimbabwe fix', () => {
  const now = 1_000_000;
  const allowed = pickupAutofillFix({
    permission: 'granted',
    latitude: -17.8292,
    longitude: 31.0522,
    accuracyMetres: 20,
    capturedAt: now - 1000,
    now,
  });
  assert.ok(allowed);
  assert.equal(pickupAutofillFix({ permission: 'prompt', latitude: -17.8292, longitude: 31.0522, accuracyMetres: 20, capturedAt: now, now }), null);
  assert.equal(pickupAutofillFix({ permission: 'granted', latitude: 52.3, longitude: 4.9, accuracyMetres: 10, capturedAt: now, now }), null);
});

test('the create body carries the resolved stop and offer', () => {
  const stop = applyResolvedStop({ ...emptyStop(), address: '12 Samora', contactName: 'Tariro', contactPhone: '771234567' }, {
    label: '12 Samora Machel, Harare',
    latitude: '-17.8292000',
    longitude: '31.0522000',
    provider: 'google_places',
    placeId: 'place-1',
    precision: 'exact',
  });
  const draft = emptyBookingDraft();
  draft.pickup = stop;
  draft.dropoff = { ...stop, placeId: 'place-2' };
  const prepared = prepareBooking(draft);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const body = v2CreateBody(prepared.booking, '4.50');
  assert.equal(body.offeredPrice, '4.50');
  assert.equal(body.serviceClass, 'FLEXIBLE');
  assert.equal(body.paymentMethod, 'CASH');
  assert.equal(body.pickup.contactPhone, '+263771234567');
});

function mapStorage(saved: Map<string, string>) {
  return {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value); },
    removeItem: (key: string) => { saved.delete(key); },
  };
}
