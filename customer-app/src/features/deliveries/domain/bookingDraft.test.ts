import { describe, expect, it } from 'vitest';

import {
  createBody,
  emptyBookingDraft,
  prepareBooking,
  quoteBody,
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
    expect(createBody(prepared.booking, '2.50').offeredPrice).toBe('2.50');
    expect(createBody(prepared.booking, '2.50').pickup).toMatchObject({
      placeId: 'ChIJpickup0001',
      coordinateSource: 'GOOGLE_PLACES',
    });
    expect(createBody(prepared.booking, '2.50')).not.toHaveProperty('suggestedPrice');
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
