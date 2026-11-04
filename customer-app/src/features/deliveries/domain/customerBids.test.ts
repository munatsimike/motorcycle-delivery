import { describe, expect, it } from 'vitest';

import { nextMarketplaceSignal } from '../../account/domain/customerAccount';
import { createAcceptanceKeys } from './acceptanceKeys';
import type { CustomerDeliveryDetail } from './customerDeliveryDetail';
import {
  acceptanceFromAssignedDelivery,
  acceptancePrompt,
  acceptableBids,
  agreedPriceDiffers,
  bidsAfterFailure,
  confirmationRiderName,
  confirmRiderSheetState,
  committedDelivery,
  createAcceptanceGate,
  duplicateAcceptanceNotice,
  keepsAcceptanceKey,
  readBidAcceptance,
  readCustomerBids,
  RIDER_SELECTION_IN_PROGRESS,
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
    pickupApproach: null,
    rider: null,
    rating: { eligible: false, submitted: false, stars: null },
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

function assignedRider(name: string) {
  return {
    name,
    verified: true,
    motorcycle: null,
    registrationNumber: null,
    phone: null,
    hasProfilePhoto: false,
  };
}

function unusedRepository(patch: Partial<CustomerDeliveryRepository> = {}): CustomerDeliveryRepository {
  return {
    quote: () => Promise.reject(new Error('unused')),
    create: () => Promise.reject(new Error('unused')),
    createOpenRequest: () => Promise.reject(new Error('unused')),
    getById: () => Promise.reject(new Error('unused')),
    list: () => Promise.reject(new Error('unused')),
    listBids: () => Promise.resolve([]),
    acceptBid: () => Promise.reject(new Error('unused')),
    search: () => Promise.reject(new Error('unused')),
    adjustOffer: () => Promise.reject(new Error('unused')),
    cancel: () => Promise.reject(new Error('unused')),
    dismissBid: () => Promise.reject(new Error('unused')),
    rateDelivery: () => Promise.reject(new Error('unused')),
    ...patch,
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
    expect(bids.every((item) => item.hasProfilePhoto === false)).toBe(true);
    const withPhoto = readCustomerBids([{ ...bid('bid-1', '9.00'), rider: { ...bid('bid-1', '9.00').rider, hasProfilePhoto: true } }]);
    expect(withPhoto[0]?.hasProfilePhoto).toBe(true);
    expect(bids.every((item) => item.registrationNumber === null)).toBe(true);
    const withPlate = readCustomerBids([{ ...bid('bid-1', '9.00'), rider: { ...bid('bid-1', '9.00').rider, motorcycle: 'Honda Ace', registrationNumber: 'AEX1234' } }]);
    expect(withPlate[0]).toMatchObject({ motorcycle: 'Honda Ace', registrationNumber: 'AEX1234' });
    expect(acceptableBids(bids)).toHaveLength(2);
    expect(bids.every((item) => item.averageRating === null && item.riderClass === 'SILVER' && item.pickupEtaSeconds === null)).toBe(true);
    const withEta = readCustomerBids([{ ...bid('bid-1', '9.00'), rider: { ...bid('bid-1', '9.00').rider, pickupEtaSeconds: 480 } }]);
    expect(withEta[0]?.pickupEtaSeconds).toBe(480);
    const invalidEta = readCustomerBids([{ ...bid('bid-1', '9.00'), rider: { ...bid('bid-1', '9.00').rider, pickupEtaSeconds: 0 } }]);
    expect(invalidEta[0]?.pickupEtaSeconds).toBeNull();
    const fabricated = readCustomerBids([{ ...bid('bid-1', '9.00'), rider: { ...bid('bid-1', '9.00').rider, averageRating: 4.8, ratingCount: 0 } }]);
    expect(fabricated[0]?.averageRating).toBeNull();
    expect(JSON.stringify(fabricated)).not.toContain('4.8');
    expect(JSON.stringify(bids)).not.toContain('+263');
    expect(JSON.stringify(bids)).not.toContain('rider-');
    expect(acceptancePrompt(bids[0]!)).toContain('$9.00');
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
      adjustOffer: () => Promise.reject(new Error('unused')),
      cancel: () => Promise.reject(new Error('unused')),
      dismissBid: () => Promise.reject(new Error('unused')),
      rateDelivery: () => Promise.reject(new Error('unused')),
    };
    const accepted = await acceptCustomerBid(repository, keys, 'token', 'delivery-1', 'bid-1', () => {
      created += 1;
      return `key-${created}`;
    }, 'Tendai Moyo');
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
      getById: async () => delivery({ status: 'CREATED' }),
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
      adjustOffer: () => Promise.reject(new Error('unused')),
      cancel: () => Promise.reject(new Error('unused')),
      dismissBid: () => Promise.reject(new Error('unused')),
      rateDelivery: () => Promise.reject(new Error('unused')),
    };
    const createKey = () => `fresh-${calls}`;
    await expect(acceptCustomerBid(repository, keys, 'token', 'delivery-1', 'bid-1', createKey, 'Tendai Moyo')).rejects.toThrow(/timed out/);
    expect(keepsAcceptanceKey(new Error('The request timed out. Check your connection and try again.'))).toBe(true);
    const accepted = await acceptCustomerBid(repository, keys, 'token', 'delivery-1', 'bid-1', createKey, 'Tendai Moyo');
    expect(accepted.replayed).toBe(true);
    expect(attempts).toEqual(['fresh-0', 'fresh-0']);

    const gate = createAcceptanceGate();
    expect(duplicateAcceptanceNotice(gate.begin())).toBeNull();
    expect(duplicateAcceptanceNotice(gate.begin())).toBe(RIDER_SELECTION_IN_PROGRESS);
    gate.end();
    expect(gate.begin()).toBe(true);
  });

  it('treats an assigned delivery as a successful selection after a timeout', async () => {
    const keys = createAcceptanceKeys(memory());
    const attempts: string[] = [];
    const repository = unusedRepository({
      getById: async () => delivery({
        status: 'RIDER_ASSIGNED',
        offeredPrice: '9.00',
        rider: assignedRider('Tendai Moyo'),
      }),
      acceptBid: async (_token, _deliveryId, _bidId, idempotencyKey) => {
        attempts.push(idempotencyKey);
        throw new Error('The request timed out. Check your connection and try again.');
      },
    });
    const accepted = await acceptCustomerBid(
      repository,
      keys,
      'token',
      'delivery-1',
      'bid-1',
      () => 'timeout-key',
      'Tendai Moyo',
    );
    expect(accepted).toMatchObject({
      deliveryId: 'delivery-1',
      bidId: 'bid-1',
      status: 'RIDER_ASSIGNED',
      acceptedBidAmount: '9.00',
      replayed: true,
      selectedRiderAssigned: true,
      assignedRiderName: 'Tendai Moyo',
    });
    expect(confirmationRiderName(accepted, 'Tendai Moyo')).toBe('Tendai Moyo');
    expect(attempts).toEqual(['timeout-key']);
    expect(acceptanceFromAssignedDelivery(delivery({ status: 'CREATED' }), { bidId: 'bid-1', riderName: 'Tendai Moyo' })).toBeNull();
    const nextKey = await keys.keyFor('delivery-1', 'bid-1', () => 'cleared-key');
    expect(nextKey).toBe('cleared-key');
  });

  it('shows the assigned rider when a different rider won after an ambiguous failure', async () => {
    const keys = createAcceptanceKeys(memory());
    const repository = unusedRepository({
      getById: async () => delivery({
        status: 'RIDER_ASSIGNED',
        offeredPrice: '7.50',
        rider: assignedRider('Rudo Ncube'),
      }),
      acceptBid: async () => {
        throw new Error('The request timed out. Check your connection and try again.');
      },
    });
    const accepted = await acceptCustomerBid(
      repository,
      keys,
      'token',
      'delivery-1',
      'bid-1',
      () => 'other-rider-key',
      'Tendai Moyo',
    );
    expect(accepted.selectedRiderAssigned).toBe(false);
    expect(accepted.assignedRiderName).toBe('Rudo Ncube');
    expect(accepted.bidId).toBe('bid-1');
    expect(confirmationRiderName(accepted, 'Tendai Moyo')).toBe('Rudo Ncube');
  });

  it('locks Confirm rider while acceptance is running', () => {
    expect(confirmRiderSheetState(null, 'bid-1')).toEqual({
      loading: false,
      confirmLocked: false,
      keepComparingLocked: false,
    });
    expect(confirmRiderSheetState('bid-1', 'bid-1')).toEqual({
      loading: true,
      confirmLocked: true,
      keepComparingLocked: true,
    });
    expect(confirmRiderSheetState('bid-2', 'bid-1').loading).toBe(false);
  });

  it('reconciles a network failure before asking the customer to try again', async () => {
    const keys = createAcceptanceKeys(memory());
    const attempts: string[] = [];
    const repository: CustomerDeliveryRepository = {
      quote: () => Promise.reject(new Error('unused')),
      create: () => Promise.reject(new Error('unused')),
      createOpenRequest: () => Promise.reject(new Error('unused')),
      getById: async () => delivery({ status: 'CREATED' }),
      list: () => Promise.reject(new Error('unused')),
      listBids: () => Promise.resolve([]),
      acceptBid: async (_token, _deliveryId, _bidId, idempotencyKey) => {
        attempts.push(idempotencyKey);
        throw new Error('Network request failed. Check your connection and try again.');
      },
      search: () => Promise.reject(new Error('unused')),
      adjustOffer: () => Promise.reject(new Error('unused')),
      cancel: () => Promise.reject(new Error('unused')),
      dismissBid: () => Promise.reject(new Error('unused')),
      rateDelivery: () => Promise.reject(new Error('unused')),
    };
    await expect(acceptCustomerBid(repository, keys, 'token', 'delivery-1', 'bid-1', () => 'net-key', 'Tendai Moyo')).rejects.toThrow(
      /Network request failed/,
    );
    await expect(acceptCustomerBid(repository, keys, 'token', 'delivery-1', 'bid-1', () => 'other-key', 'Tendai Moyo')).rejects.toThrow(
      /Network request failed/,
    );
    expect(attempts).toEqual(['net-key', 'net-key']);
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
      adjustOffer: () => Promise.reject(new Error('unused')),
      cancel: () => Promise.reject(new Error('unused')),
      dismissBid: () => Promise.reject(new Error('unused')),
      rateDelivery: () => Promise.reject(new Error('unused')),
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
