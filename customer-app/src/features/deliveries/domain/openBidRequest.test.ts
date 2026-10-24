import { describe, expect, it } from 'vitest';

import type { PreparedBooking } from './bookingDraft';
import { quotesMatch, type DeliveryQuote } from './deliveryQuote';
import {
  openBidConfirmation,
  readOpenBidRequest,
  startsRiderSearch,
  waitsForRiderConfirmation,
} from './openBidRequest';
import type { CustomerDeliveryRepository } from './repositories/CustomerDeliveryRepository';
import { createOpenRequest } from './usecases/createOpenRequest';

describe('open bid booking', () => {
  const quote = (serviceClass: DeliveryQuote['serviceClass'], suggestedPrice = '8.00'): DeliveryQuote => ({
    distanceMeters: 1000,
    pricingVersion: 2,
    currency: 'USD',
    suggestedPrice,
    serviceClass,
  });

  it('treats a service-class change as a new quote', () => {
    expect(quotesMatch(quote('EXPRESS'), quote('FLEXIBLE'))).toBe(false);
    expect(quotesMatch(quote('EXPRESS'), quote('EXPRESS', '9.00'))).toBe(false);
    expect(quotesMatch(quote('EXPRESS'), quote('EXPRESS'))).toBe(true);
  });

  it('reads an open request and does not start search or rider confirmation', async () => {
    const calls: string[] = [];
    const repository: CustomerDeliveryRepository = {
      quote: () => Promise.reject(new Error('unused')),
      create: () => Promise.reject(new Error('unused')),
      createOpenRequest: async () => readOpenBidRequest({
        id: 'delivery-1',
        status: 'CREATED',
        serviceClass: 'FLEXIBLE',
        deliverBy: '2026-10-24T16:30:00.000Z',
        suggestedPrice: '8.00',
        currency: 'USD',
        offeredPrice: null,
        searchGeneration: 0,
      }),
      getById: () => Promise.reject(new Error('unused')),
      list: () => Promise.reject(new Error('unused')),
      listBids: () => Promise.reject(new Error('unused')),
      acceptBid: () => Promise.reject(new Error('unused')),
      search: async () => {
        calls.push('search');
      },
      cancel: () => Promise.reject(new Error('unused')),
    };
    const created = await createOpenRequest(repository, 'token', {
      serviceClass: 'FLEXIBLE',
      deliverBy: '2026-10-24T16:30:00.000Z',
    } as PreparedBooking);
    expect(created.id).toBe('delivery-1');
    expect(openBidConfirmation(created)).toBe('Open for rider bids');
    expect(startsRiderSearch()).toBe(false);
    expect(waitsForRiderConfirmation()).toBe(false);
    expect(calls).toEqual([]);
  });

  it('rejects a created delivery that already has an offer or a search', () => {
    expect(() => readOpenBidRequest({
      id: 'delivery-1',
      status: 'CREATED',
      serviceClass: 'EXPRESS',
      deliverBy: '2026-10-24T16:30:00.000Z',
      suggestedPrice: '8.00',
      currency: 'USD',
      offeredPrice: '8.00',
    })).toThrow('Delivery details are unavailable.');
    expect(() => readOpenBidRequest({
      id: 'delivery-1',
      status: 'SEARCHING',
      serviceClass: 'EXPRESS',
      deliverBy: '2026-10-24T16:30:00.000Z',
      suggestedPrice: '8.00',
      currency: 'USD',
      offeredPrice: null,
    })).toThrow('Delivery details are unavailable.');
  });
});
