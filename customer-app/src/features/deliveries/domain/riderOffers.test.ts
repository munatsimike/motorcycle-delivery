import { describe, expect, it } from 'vitest';

import type { CustomerBid } from './customerBids';
import { readCustomerBids } from './customerBids';
import {
  arrivalTimeLabel,
  completedDeliveriesLabel,
  customerDistanceLabel,
  tripCountLabel,
  deliveryAwaitsRiderOffers,
  mergeIncomingOffers,
  offerCountLabel,
  offersMissingSince,
  parcelTypeLabel,
  proximityLabel,
  receivedOfferCountLabel,
  riderProfileFacts,
  riderInitials,
  showsRiderOffers,
  sortRiderOffers,
} from './riderOffers';

function offer(patch: Partial<CustomerBid> & Pick<CustomerBid, 'id' | 'amount'>): CustomerBid {
  return {
    deliveryId: 'delivery-1',
    currency: 'USD',
    status: 'OPEN',
    createdAt: '2026-10-24T09:00:00.000Z',
    riderName: 'Tendai Moyo',
    verified: false,
    completedDeliveries: 0,
    distanceMeters: null,
    motorcycle: null,
    hasProfilePhoto: false,
    ...patch,
  };
}

describe('rider offer sorting', () => {
  const bids = [
    offer({ id: 'b', amount: '4.00', distanceMeters: 800, riderName: 'Rudo Ncube' }),
    offer({ id: 'a', amount: '3.50', distanceMeters: null, riderName: 'New Person' }),
    offer({ id: 'c', amount: '3.50', distanceMeters: 1_200, riderName: 'Tendai Moyo' }),
    offer({ id: 'd', amount: '5.00', distanceMeters: 400, riderName: 'Chipo Dube' }),
  ];

  it('defaults to lowest price, then distance, then id', () => {
    expect(sortRiderOffers(bids, 'price').map((bid) => bid.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('sorts nearest riders first and leaves unknown distance last', () => {
    expect(sortRiderOffers(bids, 'distance').map((bid) => bid.id)).toEqual(['d', 'b', 'c', 'a']);
  });

  it('keeps the original list unchanged', () => {
    const original = bids.map((bid) => bid.id);
    sortRiderOffers(bids, 'price');
    expect(bids.map((bid) => bid.id)).toEqual(original);
  });

  it('labels a new rider, a missing avatar, and a real completed count', () => {
    expect(completedDeliveriesLabel(0)).toBeNull();
    expect(completedDeliveriesLabel(124)).toBe('124 deliveries');
    expect(riderInitials('Tawanda Chikomo')).toBe('TC');
    expect(riderInitials('')).toBe('?');
    expect(proximityLabel(null)).toBeNull();
    expect(proximityLabel(1_200)).toBe('1.2 km from pickup');
    expect(proximityLabel(450)).toBe('450 m from pickup');
    expect(customerDistanceLabel(null)).toBeNull();
    expect(customerDistanceLabel(450)).toBe('450 m from you');
    expect(customerDistanceLabel(1_200)).toBe('1.2 km from you');
    expect(arrivalTimeLabel(null)).toBeNull();
    expect(arrivalTimeLabel(450)).toBe('about 1 min');
    expect(arrivalTimeLabel(1_200)).toBe('about 3 min');
    expect(tripCountLabel(0)).toBe('0 trips');
    expect(tripCountLabel(1)).toBe('1 trip');
    expect(tripCountLabel(12)).toBe('12 trips');
    expect(offerCountLabel(1)).toBe('1 rider has made an offer');
    expect(offerCountLabel(3)).toBe('3 riders have made offers');
    expect(parcelTypeLabel('documents')).toBe('Document');
    expect(offersMissingSince(['a', 'b'], ['b'])).toBe(true);
    expect(offersMissingSince(['b'], ['b', 'c'])).toBe(false);
    expect(showsRiderOffers({ status: 'CREATED', serviceClass: 'FLEXIBLE', deliverBy: '2026-10-28T12:00:00.000Z' })).toBe(true);
    expect(showsRiderOffers({ status: 'CREATED', serviceClass: 'EXPRESS', deliverBy: '2026-10-28T12:00:00.000Z' })).toBe(true);
    expect(showsRiderOffers({ status: 'CREATED', serviceClass: 'FLEXIBLE' })).toBe(true);
    expect(showsRiderOffers({ status: 'SEARCHING', serviceClass: 'FLEXIBLE', deliverBy: '2026-10-28T12:00:00.000Z' })).toBe(false);
    expect(offerCountLabel(1, 'EXPRESS')).toBe('1 rider is interested');
    expect(offerCountLabel(2, 'EXPRESS')).toBe('2 riders are interested');
    expect(showsRiderOffers({ status: 'RIDER_ASSIGNED', serviceClass: 'FLEXIBLE' })).toBe(false);
    expect(deliveryAwaitsRiderOffers({ status: 'SEARCHING', serviceClass: 'FLEXIBLE' })).toBe(false);
    expect(deliveryAwaitsRiderOffers({ status: 'SEARCHING', serviceClass: null })).toBe(false);
    expect(deliveryAwaitsRiderOffers({ status: 'CREATED', serviceClass: 'EXPRESS', deliverBy: '2026-10-28T12:00:00.000Z' })).toBe(true);
    expect(deliveryAwaitsRiderOffers({ status: 'CREATED', serviceClass: 'EXPRESS' })).toBe(true);
    expect(deliveryAwaitsRiderOffers({ status: 'NO_RIDER_FOUND', serviceClass: 'EXPRESS', deliverBy: null })).toBe(false);
    expect(deliveryAwaitsRiderOffers({ status: 'ASSIGNED', serviceClass: null })).toBe(false);
    expect(deliveryAwaitsRiderOffers(null)).toBe(false);
    expect(receivedOfferCountLabel(1)).toBe('(1) offer received');
    expect(receivedOfferCountLabel(3)).toBe('(3) offers received');
  });

  it('keeps offer order, updates prices, and drops closed or repeated offers', () => {
    const first = [
      offer({ id: 'a', amount: '3.00' }),
      offer({ id: 'b', amount: '4.00' }),
    ];
    const next = [
      offer({ id: 'b', amount: '4.50' }),
      offer({ id: 'b', amount: '9.00' }),
      offer({ id: 'c', amount: '5.00' }),
      offer({ id: 'a', amount: '3.00', status: 'WITHDRAWN' }),
      offer({ id: 'd', amount: '6.00', status: 'EXPIRED' }),
    ];
    expect(mergeIncomingOffers(first, next).map((bid) => `${bid.id}:${bid.amount}`)).toEqual(['b:4.50', 'c:5.00']);
    expect(first.map((bid) => bid.id)).toEqual(['a', 'b']);
  });

  it('lists only rider facts the bid payload actually contains', () => {
    expect(riderProfileFacts(offer({
      id: 'full',
      amount: '4.00',
      motorcycle: 'Honda Ace',
      completedDeliveries: 12,
      distanceMeters: 450,
    }))).toEqual(['Verified motorcycle: Honda Ace', '12 deliveries', '450 m from pickup']);
    expect(riderProfileFacts(offer({ id: 'sparse', amount: '4.00' }))).toEqual([]);
  });

  it('reads public rider fields and drops a phone number', () => {
    const [bid] = readCustomerBids([{
      id: 'bid-1',
      deliveryId: 'delivery-1',
      amount: '3.50',
      currency: 'USD',
      status: 'OPEN',
      createdAt: '2026-10-24T09:00:00.000Z',
      rider: {
        id: 'rider-1',
        name: 'Tawanda Chikomo',
        phone: '+263771234567',
        verified: true,
        completedDeliveries: 12,
        distanceMeters: 1200,
        motorcycle: 'Honda Ace',
      },
    }]);
    expect(bid).toMatchObject({
      riderName: 'Tawanda Chikomo',
      verified: true,
      completedDeliveries: 12,
      distanceMeters: 1200,
      motorcycle: 'Honda Ace',
    });
    expect(JSON.stringify(bid)).not.toContain('+263');
    expect(JSON.stringify(bid)).not.toContain('rider-');
  });
});
