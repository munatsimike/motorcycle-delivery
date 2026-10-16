import { describe, expect, it } from 'vitest';

import {
  createBody,
  emptyBookingDraft,
  prepareBooking,
  quoteBody,
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
    },
    dropoff: {
      address: '4 Jason Moyo Avenue',
      landmark: 'Near the market',
      instructions: '',
      contactName: 'Rudo Ncube',
      contactPhone: '+263777654321',
      latitude: '-17.8250',
      longitude: '31.0330',
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
    expect(createBody(prepared.booking, '2.50')).not.toHaveProperty('suggestedPrice');
  });

  it('rejects a stop that has an address but no coordinates', () => {
    const incomplete = draft();
    incomplete.pickup.latitude = '';
    incomplete.pickup.longitude = '';
    expect(prepareBooking(incomplete)).toEqual({ ok: false, error: 'Enter a valid pickup location' });
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

  it('rejects a Dutch mobile for a delivery contact', () => {
    expect(zimbabweMobileE164('0612345678')).toBeNull();
    const incomplete = draft();
    incomplete.pickup.contactPhone = '0612345678';
    expect(prepareBooking(incomplete)).toEqual({ ok: false, error: 'Enter the pickup contact phone' });
  });

  it('requires parcel choices before a quote can be confirmed', () => {
    const incomplete = draft();
    incomplete.size = null;
    expect(prepareBooking(incomplete)).toEqual({ ok: false, error: 'Choose a parcel size' });
  });
});
