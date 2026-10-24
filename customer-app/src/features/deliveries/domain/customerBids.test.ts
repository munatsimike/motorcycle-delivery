import { describe, expect, it } from 'vitest';

import { nextMarketplaceSignal } from '../../account/domain/customerAccount';
import { createAcceptanceKeys } from './acceptanceKeys';
import type { CustomerDeliveryDetail } from './customerDeliveryDetail';
import {
  acceptancePrompt,
  acceptableBids,
  agreedPriceDiffers,
  bidsAfterFailure,
  committedDelivery,
  createAcceptanceGate,
  keepsAcceptanceKey,
  readBidAcceptance,
  readCustomerBids,
  startsRiderSearch,
  waitsForRiderConfirmation,
} from './customerBids';
import type { CustomerDeliveryRepository } from './repositories/CustomerDeliveryRepository';
import { acceptCustomerBid } from './usecases/acceptCustomerBid';

function delivery(patch: Partial<CustomerDeliveryDetail> = {}): CustomerDeliveryDetail {
  return {
    id: 'delivery-1',
    status: 'CREATED',
    currency: 'USD',
    offeredPrice: null,
    suggestedPrice: '8.00',
    serviceClass: 'FLEXIBLE',
    deliverBy: '2026-10-24T16:30:00.000Z',
    distanceMeters: 100,
    pickupAddress: 'Pickup',
    pickupLatitude: null,
    pickupLongitude: null,
    dropoffAddress: 'Drop-off',
    dropoffLatitude: null,
    dropoffLongitude: null,
    parcelDescription: 'Box',
    createdAt: null,
    riderLocation: null,
    ...patch,
  };
}

function bid(id: string, amount: string, status: 'OPEN' | 'WITHDRAWN' = 'OPEN') {
  return {
    id,
    deliveryId: 'delivery-1',
    amount,
    amountCents: 900,
    currency: 'USD',
    status,
    createdAt: '2026-10-24T09:00:00.000Z',
    rider: { id: `rider-${id}`, name: id === 'bid-1' ? 'Tendai Moyo' : 'Rudo Ncube', phone: '+263771234567' },
  };
}

function memory() {
  const values = new Map<string, string>();
  return {
    async getItem(key: string) {
      return values.get(key) ?? null;
    },
    async setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe('customer bids', () => {
  it('reads an empty list and several bids without private rider fields', () => {
    expect(readCustomerBids([])).toEqual([]);
    const bids = readCustomerBids([bid('bid-1', '9.00'), bid('bid-2', '7.50')]);
    expect(bids.map((item) => item.riderName)).toEqual(['Tendai Moyo', 'Rudo Ncube']);
    expect(acceptableBids(bids)).toHaveLength(2);
    expect(JSON.stringify(bids)).not.toContain('+263');
    expect(JSON.stringify(bids)).not.toContain('rider-');
    expect(acceptancePrompt(bids[0]!)).toContain('USD 9.00');
    expect(acceptancePrompt(bids[0]!)).toContain('Tendai Moyo');
  });

  it('accepts one of two bids, keeps the agreed price apart from the suggestion, and does not wait for the rider', async () => {
    const keys = createAcceptanceKeys(memory());
    const searches: string[] = [];
    const attempts: string[] = [];
    let created = 0;
    const repository: CustomerDeliveryRepository = {
      quote: () => Promise.reject(new Error('unused')),
      create: () => Promise.reject(new Error('unused')),
      createOpenRequest: () => Promise.reject(new Error('unused')),
      getById: () => Promise.reject(new Error('unused')),
      list: () => Promise.reject(new Error('unused')),
      listBids: () => Promise.resolve(readCustomerBids([bid('bid-1', '9.00'), bid('bid-2', '7.50')])),
      acceptBid: async (_token, deliveryId, bidId, idempotencyKey) => {
        attempts.push(idempotencyKey);
        return readBidAcceptance({
          deliveryId,
          bidId,
          status: 'RIDER_ASSIGNED',
          acceptedBidAmount: '9.00',
          commissionAmount: '0.90',
          replayed: false,
        });
      },
      search: async (token, deliveryId) => {
        searches.push(`${token}:${deliveryId}`);
      },
      cancel: () => Promise.reject(new Error('unused')),
    };
    const accepted = await acceptCustomerBid(repository, keys, 'token', 'delivery-1', 'bid-1', () => {
      created += 1;
      return `key-${created}`;
    });
    const committed = committedDelivery(delivery(), accepted);
    expect(accepted.status).toBe('RIDER_ASSIGNED');
    expect(committed.offeredPrice).toBe('9.00');
    expect(committed.suggestedPrice).toBe('8.00');
    expect(agreedPriceDiffers(committed.offeredPrice ?? '', committed.suggestedPrice)).toBe(true);
    expect(committed.riderLocation).toBeNull();
    expect(waitsForRiderConfirmation()).toBe(false);
    expect(startsRiderSearch()).toBe(false);
    expect(searches).toEqual([]);
    expect(JSON.stringify(accepted)).not.toContain('commission');
  });

  it('reuses the acceptance key after a timeout and blocks a second tap', async () => {
    const keys = createAcceptanceKeys(memory());
    const attempts: string[] = [];
    let calls = 0;
    const repository: CustomerDeliveryRepository = {
      quote: () => Promise.reject(new Error('unused')),
      create: () => Promise.reject(new Error('unused')),
      createOpenRequest: () => Promise.reject(new Error('unused')),
      getById: () => Promise.reject(new Error('unused')),
      list: () => Promise.reject(new Error('unused')),
      listBids: () => Promise.resolve([]),
      acceptBid: async (_token, _deliveryId, _bidId, idempotencyKey) => {
        attempts.push(idempotencyKey);
        calls += 1;
        if (calls === 1) {
          throw new Error('The request timed out. Check your connection and try again.');
        }
        return readBidAcceptance({
          deliveryId: 'delivery-1',
          bidId: 'bid-1',
          status: 'RIDER_ASSIGNED',
          acceptedBidAmount: '9.00',
          replayed: true,
        });
      },
      search: () => Promise.reject(new Error('unused')),
      cancel: () => Promise.reject(new Error('unused')),
    };
    const createKey = () => `fresh-${calls}`;
    await expect(acceptCustomerBid(repository, keys, 'token', 'delivery-1', 'bid-1', createKey)).rejects.toThrow(/timed out/);
    expect(keepsAcceptanceKey(new Error('The request timed out. Check your connection and try again.'))).toBe(true);
    const accepted = await acceptCustomerBid(repository, keys, 'token', 'delivery-1', 'bid-1', createKey);
    expect(accepted.replayed).toBe(true);
    expect(attempts).toEqual(['fresh-0', 'fresh-0']);

    const gate = createAcceptanceGate();
    expect(gate.begin()).toBe(true);
    expect(gate.begin()).toBe(false);
    gate.end();
    expect(gate.begin()).toBe(true);
  });

  it('keeps the last bids and marketplace mode when acceptance is rejected', async () => {
    const keys = createAcceptanceKeys(memory());
    const current = readCustomerBids([bid('bid-1', '9.00'), bid('bid-2', '7.50')]);
    const repository: CustomerDeliveryRepository = {
      quote: () => Promise.reject(new Error('unused')),
      create: () => Promise.reject(new Error('unused')),
      createOpenRequest: () => Promise.reject(new Error('unused')),
      getById: () => Promise.reject(new Error('unused')),
      list: () => Promise.reject(new Error('unused')),
      listBids: () => Promise.reject(new Error('Network request failed. Check your connection and try again.')),
      acceptBid: async () => {
        throw new Error('Wallet capacity is not enough for this bid');
      },
      search: () => Promise.reject(new Error('unused')),
      cancel: () => Promise.reject(new Error('unused')),
    };
    await expect(acceptCustomerBid(repository, keys, 'token', 'delivery-1', 'bid-1', () => 'wallet-key')).rejects.toThrow(
      'Wallet capacity is not enough for this bid',
    );
    await expect(repository.listBids('token', 'delivery-1')).rejects.toThrow(/Network request failed/);
    expect(bidsAfterFailure(current)).toEqual(current);
    expect(nextMarketplaceSignal(true, { type: 'network' })).toBe(true);
    expect(nextMarketplaceSignal(true, { type: 'authentication' })).toBe(true);
    repository.acceptBid = async () => {
      throw new Error('This delivery is not open for bids');
    };
    await expect(acceptCustomerBid(repository, keys, 'token', 'delivery-1', 'bid-2', () => 'other-key')).rejects.toThrow(
      'This delivery is not open for bids',
    );
    expect(waitsForRiderConfirmation()).toBe(false);
  });
});
