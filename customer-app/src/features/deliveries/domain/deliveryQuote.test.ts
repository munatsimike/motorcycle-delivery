import { describe, expect, it } from 'vitest';

import { readCustomerDeliveryDetail } from './customerDeliveryDetail';
import { canOfferQuotedPrice, quotesMatch, readDeliveryQuote } from './deliveryQuote';
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
  });
});

describe('createDelivery', () => {
  it('does not call the API when the quoted price cannot be offered', async () => {
    const repository: CustomerDeliveryRepository = {
      quote: () => Promise.reject(new Error('unused')),
      create: () => Promise.reject(new Error('create should not be called')),
      getById: () => Promise.reject(new Error('unused')),
      list: () => Promise.reject(new Error('unused')),
      search: () => Promise.reject(new Error('unused')),
    };
    await expect(createDelivery(repository, 'token', {} as PreparedBooking, '0.00')).rejects.toThrow(
      'The quoted price cannot be booked.',
    );
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
      pickup: { address: '12 Samora Machel Avenue' },
      dropoff: { address: '4 Jason Moyo Avenue' },
      parcel: { description: 'Documents' },
    })).toMatchObject({
      id: 'delivery-1',
      status: 'CREATED',
      offeredPrice: '4.50',
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
