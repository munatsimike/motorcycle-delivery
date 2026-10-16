import { describe, expect, it } from 'vitest';

import {
  appendDeliveries,
  customerDeliveryListPath,
  deliveryTrackingTarget,
  readCustomerDeliveryPage,
  replaceDeliveries,
} from './customerDeliveryList';
import { deliveriesInGroup } from './deliveryStatus';

const payload = {
  data: [
    {
      id: 'delivery-1',
      reference: 'delivery-1',
      status: 'CREATED',
      createdAt: '2026-10-16T12:00:00.000Z',
      pickup: { address: '12 Samora Machel Avenue', contactPhone: '+263771234567' },
      dropoff: { address: '4 Jason Moyo Avenue' },
      riderProfileId: 'rider-1',
    },
    {
      id: 'delivery-1',
      reference: 'delivery-1',
      status: 'CREATED',
      createdAt: '2026-10-16T12:00:00.000Z',
      pickup: { address: '12 Samora Machel Avenue' },
      dropoff: { address: '4 Jason Moyo Avenue' },
    },
    {
      id: 'delivery-2',
      reference: 'delivery-2',
      status: 'DELIVERED',
      createdAt: '2026-10-01T00:00:00.000Z',
      pickup: { address: 'Old pickup' },
      dropoff: { address: 'Old drop-off' },
    },
  ],
  pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
};

describe('customer delivery list', () => {
  it('reads a page without keeping contact or rider fields', () => {
    const page = readCustomerDeliveryPage(payload);
    expect(page).toEqual({
      page: 1,
      totalPages: 1,
      deliveries: [
        {
          id: 'delivery-1',
          status: 'CREATED',
          createdAt: '2026-10-16T12:00:00.000Z',
          pickupAddress: '12 Samora Machel Avenue',
          dropoffAddress: '4 Jason Moyo Avenue',
        },
        {
          id: 'delivery-2',
          status: 'DELIVERED',
          createdAt: '2026-10-01T00:00:00.000Z',
          pickupAddress: 'Old pickup',
          dropoffAddress: 'Old drop-off',
        },
      ],
    });
    expect(page.deliveries[0]).not.toHaveProperty('contactPhone');
    expect(JSON.stringify(page)).not.toContain('rider-1');
  });

  it('groups active and past deliveries from the same page', () => {
    const page = readCustomerDeliveryPage(payload);
    expect(deliveriesInGroup(page.deliveries, 'active').map((delivery) => delivery.id)).toEqual(['delivery-1']);
    expect(deliveriesInGroup(page.deliveries, 'history').map((delivery) => delivery.id)).toEqual(['delivery-2']);
  });

  it('replaces the first page and appends later pages without duplicates', () => {
    const first = readCustomerDeliveryPage(payload).deliveries;
    const replaced = replaceDeliveries(first);
    const appended = appendDeliveries(replaced, [first[0]!, {
      id: 'delivery-3',
      status: 'FAILED',
      createdAt: '2026-10-16T12:00:00.000Z',
      pickupAddress: 'Pickup',
      dropoffAddress: 'Drop-off',
    }]);
    expect(appended.map((delivery) => delivery.id)).toEqual(['delivery-1', 'delivery-2', 'delivery-3']);
  });

  it('asks only for the signed-in customer list', () => {
    expect(customerDeliveryListPath(2, ['CREATED', 'SEARCHING'])).toBe(
      '/customers/me/deliveries?page=2&limit=20&status=CREATED&status=SEARCHING',
    );
    expect(customerDeliveryListPath(1)).not.toContain('customerId');
  });

  it('opens tracking with the delivery id', () => {
    const page = readCustomerDeliveryPage(payload);
    expect(deliveryTrackingTarget(page.deliveries[0]!.id)).toEqual({
      screen: 'DeliveryTracking',
      params: { deliveryId: 'delivery-1' },
    });
  });

  it('rejects an empty page that is not a list', () => {
    expect(readCustomerDeliveryPage({
      data: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    })).toEqual({ deliveries: [], page: 1, totalPages: 0 });
    expect(() => readCustomerDeliveryPage({
      data: [{
        id: 'x',
        reference: 'x',
        status: 'EN_ROUTE',
        createdAt: '2026-10-16T12:00:00.000Z',
        pickup: { address: 'Pickup' },
        dropoff: { address: 'Drop-off' },
      }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    })).toThrow('Deliveries are unavailable.');
  });
});
