import { describe, expect, it } from 'vitest';

import { readCustomerDeliveryDetail } from './customerDeliveryDetail';
import {
  canOfferQuotedPrice,
  customerOfferForBooking,
  nextCustomerOffer,
  normalizeCustomerOffer,
  offerFieldText,
  quotesMatch,
  readDeliveryQuote,
} from './deliveryQuote';
import { createDelivery } from './usecases/createDelivery';
import type { CustomerDeliveryRepository } from './repositories/CustomerDeliveryRepository';
import type { PreparedBooking } from './bookingDraft';

describe('readDeliveryQuote', () => {
  it('reads the backend quote fields', () => {
    expect(readDeliveryQuote({
      distanceMeters: 1200,
      pricingVersion: 3,
      currency: 'USD',
      suggestedPrice: '4.50',
    })).toEqual({
      distanceMeters: 1200,
      pricingVersion: 3,
      currency: 'USD',
      suggestedPrice: '4.50',
    });
  });

  it('rejects a quote that does not include a price', () => {
    expect(() => readDeliveryQuote({ currency: 'USD', distanceMeters: 1, pricingVersion: 1 })).toThrow(
      'The quote could not be read.',
    );
  });
});

describe('quotesMatch', () => {
  const quote = {
    distanceMeters: 10,
    pricingVersion: 1,
    currency: 'USD' as const,
    suggestedPrice: '2.00',
  };

  it('treats a different suggested price as a new quote', () => {
    expect(quotesMatch(quote, { ...quote, suggestedPrice: '3.00' })).toBe(false);
    expect(quotesMatch(quote, quote)).toBe(true);
  });
});

describe('canOfferQuotedPrice', () => {
  it('accepts a positive quoted amount and rejects zero', () => {
    expect(canOfferQuotedPrice('2.00')).toBe(true);
    expect(canOfferQuotedPrice('0.00')).toBe(false);
    expect(canOfferQuotedPrice('1.5')).toBe(false);
    expect(canOfferQuotedPrice('1000.00')).toBe(true);
    expect(canOfferQuotedPrice('1000.01')).toBe(false);
  });
});

describe('customer offer', () => {
  it('starts from the suggested price and keeps a manual edit across a new suggestion', () => {
    const initial = nextCustomerOffer({
      current: '',
      edited: false,
      previousPinKey: null,
      pinKey: 'route-a',
      suggestedPrice: '4.50',
    });
    expect(initial).toEqual({ text: '4.50', edited: false, pinKey: 'route-a' });
    const increased = { ...initial, text: '6.00', edited: true };
    const decreased = { ...initial, text: '3.50', edited: true };
    const higherQuote = nextCustomerOffer({
      current: increased.text,
      edited: increased.edited,
      previousPinKey: increased.pinKey,
      pinKey: 'route-a',
      suggestedPrice: '5.00',
    });
    const lowerQuote = nextCustomerOffer({
      current: decreased.text,
      edited: decreased.edited,
      previousPinKey: decreased.pinKey,
      pinKey: 'route-a',
      suggestedPrice: '5.00',
    });
    expect(higherQuote.text).toBe('6.00');
    expect(lowerQuote.text).toBe('3.50');
    expect(nextCustomerOffer({
      current: '4.50',
      edited: false,
      previousPinKey: 'route-a',
      pinKey: 'route-a',
      suggestedPrice: '5.00',
    }).text).toBe('5.00');
  });

  it('resets the offer when the route changes and keeps it when the same quote is applied again', () => {
    const edited = nextCustomerOffer({
      current: '6.00',
      edited: true,
      previousPinKey: 'route-a',
      pinKey: 'route-b',
      suggestedPrice: '7.25',
    });
    expect(edited).toEqual({ text: '7.25', edited: false, pinKey: 'route-b' });
    expect(nextCustomerOffer({
      current: '6.00',
      edited: true,
      previousPinKey: 'route-a',
      pinKey: 'route-a',
      suggestedPrice: '4.50',
    })).toEqual({ text: '6.00', edited: true, pinKey: 'route-a' });
  });

  it('normalizes natural amounts and rejects invalid money', () => {
    expect(offerFieldText('$4.50')).toBe('4.50');
    expect(offerFieldText('4.567')).toBe('4.56');
    expect(offerFieldText('4,5')).toBe('4.5');
    expect(offerFieldText('4,50')).toBe('4.50');
    expect(offerFieldText('1.000,50')).toBe('1000.50');
    expect(offerFieldText('1,000')).toBe('1000');
    expect(normalizeCustomerOffer('4')).toBe('4.00');
    expect(normalizeCustomerOffer('4.5')).toBe('4.50');
    expect(normalizeCustomerOffer('4.50')).toBe('4.50');
    expect(normalizeCustomerOffer('1000')).toBe('1000.00');
    expect(customerOfferForBooking('4.5')).toEqual({ offeredPrice: '4.50' });
    for (const invalid of ['', '0', '0.00', '-1', '4.', 'NaN', 'Infinity', '$4.50', '1000.01', '10000']) {
      expect(normalizeCustomerOffer(invalid)).toBeNull();
    }
  });
});

describe('createDelivery', () => {
  it('books the edited offer and rejects an invalid amount', async () => {
    let createdOffer = '';
    const repository: CustomerDeliveryRepository = {
      quote: () => Promise.reject(new Error('unused')),
      create: (_accessToken, _booking, offeredPrice) => {
        createdOffer = offeredPrice;
        return Promise.resolve({ id: 'delivery-1' } as Awaited<ReturnType<CustomerDeliveryRepository['create']>>);
      },
      getById: () => Promise.reject(new Error('unused')),
      list: () => Promise.reject(new Error('unused')),
      search: () => Promise.reject(new Error('unused')),
      cancel: () => Promise.reject(new Error('unused')),
    };
    await expect(createDelivery(repository, 'token', {} as PreparedBooking, '0.00')).rejects.toThrow(
      'Enter an offer from $0.01 to $1,000.00.',
    );
    await expect(createDelivery(repository, 'token', {} as PreparedBooking, '4.50')).resolves.toMatchObject({ id: 'delivery-1' });
    expect(createdOffer).toBe('4.50');
  });
});

describe('readCustomerDeliveryDetail', () => {
  it('reads the created delivery without treating it as accepted', () => {
    expect(readCustomerDeliveryDetail({
      id: 'delivery-1',
      status: 'CREATED',
      currency: 'USD',
      offeredPrice: '4.50',
      suggestedPrice: '4.50',
      distanceMeters: 800,
      pickup: { address: '12 Samora Machel Avenue', latitude: '-17.8292000', longitude: '31.0522000' },
      dropoff: { address: '4 Jason Moyo Avenue' },
      parcel: { description: 'Documents' },
    })).toMatchObject({
      id: 'delivery-1',
      status: 'CREATED',
      offeredPrice: '4.50',
      pickupAddress: '12 Samora Machel Avenue',
      dropoffAddress: '4 Jason Moyo Avenue',
    });
  });

  it('keeps the address, status, and price when coordinates are missing', () => {
    expect(readCustomerDeliveryDetail({
      id: 'delivery-1',
      status: 'DELIVERED',
      currency: 'USD',
      offeredPrice: '4.50',
      suggestedPrice: '4.50',
      distanceMeters: 800,
      pickup: { address: '12 Samora Machel Avenue', latitude: null, longitude: null },
      dropoff: { address: '4 Jason Moyo Avenue', latitude: '-17.8200000' },
      parcel: { description: 'Documents' },
    })).toMatchObject({
      status: 'DELIVERED',
      offeredPrice: '4.50',
      suggestedPrice: '4.50',
      pickupAddress: '12 Samora Machel Avenue',
      pickupLatitude: null,
      pickupLongitude: null,
      dropoffAddress: '4 Jason Moyo Avenue',
      dropoffLatitude: null,
      dropoffLongitude: null,
      parcelDescription: 'Documents',
      distanceMeters: 800,
    });
  });

  it('rejects an unknown status', () => {
    expect(() => readCustomerDeliveryDetail({
      id: 'delivery-1',
      status: 'EN_ROUTE',
      currency: 'USD',
      offeredPrice: '4.50',
      suggestedPrice: '4.50',
      distanceMeters: 800,
      pickup: { address: 'Pickup' },
      dropoff: { address: 'Drop-off' },
      parcel: { description: 'Box' },
    })).toThrow('Delivery details are unavailable.');
  });
});
