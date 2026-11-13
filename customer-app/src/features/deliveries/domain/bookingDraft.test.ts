import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createBody,
  deadlineTimestamp,
  emptyBookingDraft,
  formatDeadline,
  parcelError,
  prepareBooking,
  quoteBody,
  quoteIdentity,
  v2CreateBody,
  withBookingPatch,
  contactPhoneForField,
  deliveryContactPhone,
  stopDetailsError,
  stopEntryError,
  zimbabweMobileE164,
  zimbabweNationalNumber,
  type BookingDraft,
} from './bookingDraft';

function draft(): BookingDraft {
  return {
    ...emptyBookingDraft(),
    pickup: {
      address: '  12   Samora Machel Avenue ',
      landmark: '',
      instructions: '  Call on arrival  ',
      contactName: 'Tendai Moyo',
      contactPhone: '0771234567',
      latitude: '-17.8292',
      longitude: '31.0522',
      approximate: false,
      precision: 'exact',
      placeId: 'ChIJpickup0001',
      coordinateSource: 'GOOGLE_PLACES',
    },
    dropoff: {
      address: '4 Jason Moyo Avenue',
      landmark: 'Near the market',
      instructions: '',
      contactName: 'Rudo Ncube',
      contactPhone: '+263777654321',
      latitude: '-17.8250',
      longitude: '31.0330',
      approximate: false,
      precision: 'exact',
      placeId: 'ChIJdropoff001',
      coordinateSource: 'GOOGLE_PLACES',
    },
    description: ' Documents ',
    size: 'SMALL',
    instructions: '',
    payer: 'SENDER',
    paymentMethod: 'CASH',
  };
}

describe('prepareBooking', () => {
  it('normalizes a complete draft without adding coordinates', () => {
    const prepared = prepareBooking(draft());
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    expect(prepared.booking.pickup).toMatchObject({
      address: '12 Samora Machel Avenue',
      landmark: null,
      instructions: 'Call on arrival',
      contactPhone: '+263771234567',
      latitude: -17.8292,
      longitude: 31.0522,
      placeId: 'ChIJpickup0001',
      coordinateSource: 'GOOGLE_PLACES',
    });
    expect(prepared.booking.dropoff.contactPhone).toBe('+263777654321');
    expect(prepared.booking.parcel).toEqual({
      description: 'Documents',
      size: 'SMALL',
      instructions: null,
    });
    expect(quoteBody(prepared.booking)).toEqual({
      pickup: { latitude: -17.8292, longitude: 31.0522 },
      dropoff: { latitude: -17.825, longitude: 31.033 },
    });
    const created = createBody(prepared.booking, '2.50');
    expect('offeredPrice' in created ? created.offeredPrice : null).toBe('2.50');
    expect(created.pickup).toMatchObject({
      placeId: 'ChIJpickup0001',
      coordinateSource: 'GOOGLE_PLACES',
    });
    expect(created).not.toHaveProperty('suggestedPrice');
  });

  it('accepts an area pickup without a separate house number', () => {
    const pickup = draft();
    pickup.pickup.approximate = true;
    pickup.pickup.precision = 'area';
    pickup.pickup.landmark = '';
    expect(stopDetailsError(pickup.pickup, 'pickup')).toBeNull();
  });

  it('accepts a prefilled pickup address before a map pin is chosen', () => {
    const pickup = draft();
    pickup.pickup.latitude = '';
    pickup.pickup.longitude = '';
    pickup.pickup.placeId = null;
    pickup.pickup.coordinateSource = null;
    pickup.pickup.precision = null;
    expect(stopEntryError(pickup.pickup, 'pickup')).toBeNull();
    expect(stopDetailsError(pickup.pickup, 'pickup')).toBe('Choose the pickup address');
    expect(prepareBooking(pickup)).toEqual({ ok: false, error: 'Choose the pickup address' });
  });

  it('rejects coordinates outside the valid range', () => {
    const incomplete = draft();
    incomplete.dropoff.latitude = '91';
    expect(prepareBooking(incomplete)).toEqual({ ok: false, error: 'Enter a valid drop-off location' });
  });

  it('keeps the saved Zimbabwe mobile as the digits shown beside +263', () => {
    expect(zimbabweNationalNumber('+263771234567')).toBe('771234567');
    expect(zimbabweNationalNumber('0771234567')).toBe('771234567');
    expect(zimbabweNationalNumber('771234567')).toBe('771234567');
    expect(zimbabweNationalNumber('0612345678')).toBeNull();
  });

  it('prefills a Dutch account number and keeps it as the pickup contact', () => {
    expect(contactPhoneForField('+31612345678')).toBe('+31612345678');
    expect(contactPhoneForField('+263771234567')).toBe('771234567');
    expect(zimbabweMobileE164('0612345678')).toBeNull();
    expect(deliveryContactPhone('0612345678')).toBe('+31612345678');
    const dutchPickup = draft();
    dutchPickup.pickup.contactPhone = '+31612345678';
    const prepared = prepareBooking(dutchPickup);
    expect(prepared.ok).toBe(true);
    if (prepared.ok) {
      expect(prepared.booking.pickup.contactPhone).toBe('+31612345678');
    }
  });

  it('requires parcel choices before a quote can be confirmed', () => {
    const incomplete = draft();
    incomplete.size = null;
    expect(prepareBooking(incomplete)).toEqual({ ok: false, error: 'Choose a parcel size' });
  });
});

describe('V2 booking', () => {
  const now = new Date(2026, 9, 24, 10, 0, 0, 0);
  const deadline = deadlineTimestamp({ year: 2026, month: 10, day: 24, hour: 18, minute: 30 });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('selects Express or Flexible and converts the local deadline', () => {
    const express = marketplaceDraft('EXPRESS', deadline);
    const flexible = withBookingPatch(express, { serviceClass: 'FLEXIBLE' });
    expect(flexible.pickup.address).toBe(express.pickup.address);
    expect(parcelError(express, true)).toBeNull();
    expect(parcelError({ ...express, serviceClass: null }, true)).toBe('Choose Urgent or Flexible');
    expect(formatDeadline(deadline)).toBe('24 Oct 2026, 18:30');
    expect(new Date(deadline).getHours()).toBe(18);
    expect(new Date(deadline).getMinutes()).toBe(30);
    expect(parcelError(marketplaceDraft('EXPRESS', null), true)).toBeNull();

    const preparedExpress = prepareBooking(express, { marketplace: true });
    const preparedFlexible = prepareBooking(flexible, { marketplace: true });
    expect(preparedExpress.ok && preparedFlexible.ok).toBe(true);
    if (!preparedExpress.ok || !preparedFlexible.ok) {
      return;
    }
    expect(quoteBody(preparedExpress.booking)).toMatchObject({ serviceClass: 'EXPRESS' });
    expect(quoteBody(preparedFlexible.booking)).toMatchObject({ serviceClass: 'FLEXIBLE' });
    expect(quoteIdentity(preparedExpress.booking.pinKey, 'EXPRESS'))
      .not.toBe(quoteIdentity(preparedFlexible.booking.pinKey, 'FLEXIBLE'));
    expect(quoteIdentity(preparedExpress.booking.pinKey, 'EXPRESS'))
      .toBe(quoteIdentity(preparedExpress.booking.pinKey, 'EXPRESS'));
  });

  it('sends an Express bid request without an offer, payer, or payment method', () => {
    expectMarketplaceCreate('EXPRESS', deadline);
  });

  it('sends a Flexible bid request without an offer, payer, or payment method', () => {
    expectMarketplaceCreate('FLEXIBLE', deadline);
  });

  it('creates Express and Flexible requests without a delivery date', () => {
    const express = prepareBooking(marketplaceDraft('EXPRESS', null), { marketplace: true });
    const flexible = prepareBooking(marketplaceDraft('FLEXIBLE', deadline), { marketplace: true });
    expect(express.ok && flexible.ok).toBe(true);
    if (!express.ok || !flexible.ok) {
      return;
    }
    expect(express.booking.deliverBy).toBeNull();
    expect(flexible.booking.deliverBy).toBeNull();
    expect(createBody(express.booking, '9.00')).not.toHaveProperty('deliverBy');
    expect(createBody(flexible.booking, '9.00')).not.toHaveProperty('deliverBy');
    expect(quoteBody(express.booking)).toMatchObject({ serviceClass: 'EXPRESS' });
    expect(quoteBody(flexible.booking)).toMatchObject({ serviceClass: 'FLEXIBLE' });
  });

  it('keeps the V1 quote and create payload when the marketplace is off', () => {
    const prepared = prepareBooking({ ...marketplaceDraft('EXPRESS', deadline), payer: 'SENDER', paymentMethod: 'CASH' });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    expect(prepared.booking.serviceClass).toBeNull();
    expect(prepared.booking.deliverBy).toBeNull();
    expect(quoteBody(prepared.booking)).not.toHaveProperty('serviceClass');
    const created = createBody(prepared.booking, '2.50');
    expect(created).toMatchObject({
      offeredPrice: '2.50',
      payer: 'SENDER',
      paymentMethod: 'CASH',
    });
    expect(created).not.toHaveProperty('serviceClass');
    expect(created).not.toHaveProperty('deliverBy');
  });
});

function expectMarketplaceCreate(serviceClass: 'EXPRESS' | 'FLEXIBLE', deliverBy: string | null) {
  const prepared = prepareBooking(marketplaceDraft(serviceClass, deliverBy), { marketplace: true });
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) {
    return;
  }
  const body = v2CreateBody(prepared.booking, '9.99');
  expect(prepared.booking.deliverBy).toBeNull();
  expect(body).toMatchObject({
    serviceClass,
    currency: 'USD',
    offeredPrice: '9.99',
    parcel: { description: 'Documents', size: 'SMALL', instructions: null },
    pickup: {
      address: '12 Samora Machel Avenue',
      latitude: -17.8292,
      longitude: 31.0522,
      contactPhone: '+263771234567',
    },
    dropoff: {
      address: '4 Jason Moyo Avenue',
      latitude: -17.825,
      longitude: 31.033,
      contactPhone: '+263777654321',
    },
  });
  expect(Object.keys(body).sort()).toEqual(['currency', 'dropoff', 'offeredPrice', 'parcel', 'pickup', 'serviceClass']);
  expect(body).not.toHaveProperty('deliverBy');
  expect(body).not.toHaveProperty('payer');
  expect(body).not.toHaveProperty('paymentMethod');
  expect(createBody(prepared.booking, '9.99')).toEqual(body);
}

function marketplaceDraft(serviceClass: 'EXPRESS' | 'FLEXIBLE', deliverBy: string | null): BookingDraft {
  return {
    ...draft(),
    serviceClass,
    deliverBy,
    payer: null,
    paymentMethod: null,
  };
}
