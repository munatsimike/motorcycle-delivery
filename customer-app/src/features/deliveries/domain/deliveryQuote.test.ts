import { describe, expect, it } from 'vitest';

import { displayedCustomerOffer, readCustomerDeliveryDetail } from './customerDeliveryDetail';
import {
  canOfferQuotedPrice,
  customerOfferForBooking,
  nextCustomerOffer,
  normalizeCustomerOffer,
  offerFieldText,
  quoteResultForRequest,
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
      serviceClass: null,
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
    serviceClass: null,
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
      listBids: () => Promise.reject(new Error('unused')),
      acceptBid: () => Promise.reject(new Error('unused')),
      search: () => Promise.reject(new Error('unused')),
      adjustOffer: () => Promise.reject(new Error('unused')),
      cancel: () => Promise.reject(new Error('unused')),
      createOpenRequest: () => Promise.reject(new Error('unused')),
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
      customerOffer: null,
      pickupAddress: '12 Samora Machel Avenue',
      dropoffAddress: '4 Jason Moyo Avenue',
    });
  });

  it('reads the customer offer and falls back to the suggested price', () => {
    const saved = readCustomerDeliveryDetail({
      id: 'delivery-1',
      status: 'NO_RIDER_FOUND',
      currency: 'USD',
      offeredPrice: null,
      customerOffer: '4.00',
      suggestedPrice: '8.88',
      distanceMeters: 800,
      pickup: { address: '12 Samora Machel Avenue', latitude: '-17.8292000', longitude: '31.0522000' },
      dropoff: { address: '4 Jason Moyo Avenue' },
      parcel: { description: 'Documents' },
    });
    expect(saved.customerOffer).toBe('4.00');
    expect(saved.offeredPrice).toBeNull();
    expect(displayedCustomerOffer(saved)).toBe('4.00');
    expect(displayedCustomerOffer({ customerOffer: null, suggestedPrice: '8.88' })).toBe('8.88');
    expect(displayedCustomerOffer({ suggestedPrice: '8.88' })).toBe('8.88');
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

  it('reads a V2 delivery with no agreed price and keeps a fresh rider point after assignment', () => {
    const detail = readCustomerDeliveryDetail({
      id: 'delivery-1',
      status: 'RIDER_ASSIGNED',
      currency: 'USD',
      offeredPrice: null,
      suggestedPrice: '8.00',
      serviceClass: 'EXPRESS',
      deliverBy: '2026-10-24T16:30:00.000Z',
      distanceMeters: 800,
      pickup: { address: 'Pickup', latitude: '-17.8000000', longitude: '31.1000000' },
      dropoff: { address: 'Drop-off', latitude: '-17.8100000', longitude: '31.1100000' },
      parcel: { description: 'Box' },
      riderLocation: { latitude: '-17.8010000', longitude: '31.1090000' },
    });
    expect(detail.offeredPrice).toBeNull();
    expect(detail.serviceClass).toBe('EXPRESS');
    expect(detail.riderLocation).toEqual({ latitude: -17.801, longitude: 31.109, updatedAt: null });
    expect(detail.pickupApproach).toBeNull();
  });

  it('keeps a collecting rider point and drops it once the parcel is collected', () => {
    const point = { latitude: '-17.8010000', longitude: '31.1090000' };
    const collecting = readCustomerDeliveryDetail({
      id: 'delivery-1',
      status: 'COLLECTING',
      currency: 'USD',
      offeredPrice: '9.00',
      suggestedPrice: '8.00',
      serviceClass: 'FLEXIBLE',
      deliverBy: '2026-10-24T16:30:00.000Z',
      distanceMeters: 800,
      pickup: { address: 'Pickup' },
      dropoff: { address: 'Drop-off' },
      parcel: { description: 'Box' },
      riderLocation: { ...point, updatedAt: '2026-10-28T16:40:00.000Z' },
      pickupApproach: {
        metres: 2400,
        seconds: 420,
        line: [{ latitude: -17.801, longitude: 31.109 }, { latitude: -17.82, longitude: 31.05 }],
      },
    });
    expect(collecting.riderLocation).toEqual({ latitude: -17.801, longitude: 31.109, updatedAt: '2026-10-28T16:40:00.000Z' });
    expect(collecting.pickupApproach).toEqual({
      metres: 2400,
      seconds: 420,
      line: [{ latitude: -17.801, longitude: 31.109 }, { latitude: -17.82, longitude: 31.05 }],
    });
    const collected = readCustomerDeliveryDetail({
      id: 'delivery-1',
      status: 'COLLECTED',
      currency: 'USD',
      offeredPrice: '9.00',
      suggestedPrice: '8.00',
      serviceClass: 'FLEXIBLE',
      deliverBy: '2026-10-24T16:30:00.000Z',
      distanceMeters: 800,
      pickup: { address: 'Pickup' },
      dropoff: { address: 'Drop-off' },
      parcel: { description: 'Box' },
      riderLocation: point,
      pickupApproach: { metres: 2400, seconds: 420, line: [] },
    });
    expect(collected.riderLocation).toBeNull();
    expect(collected.pickupApproach).toBeNull();
  });
});

describe('quote freshness', () => {
  it('drops a quote that belongs to an earlier route or class request', () => {
    const first = { suggestedPrice: '8.00', serviceClass: 'EXPRESS' as const };
    const second = { suggestedPrice: '11.00', serviceClass: 'FLEXIBLE' as const };
    expect(quoteResultForRequest(1, 2, first)).toBeNull();
    expect(quoteResultForRequest(2, 2, second)).toEqual(second);
  });
});
