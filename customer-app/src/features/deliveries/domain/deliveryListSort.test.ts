import { describe, expect, it } from 'vitest';
import type { CustomerDelivery } from './deliveryStatus';
import { sortDeliveries } from './deliveryListSort';

function delivery(id: string, overrides: Partial<CustomerDelivery> = {}): CustomerDelivery {
  return {
    id,
    status: 'CREATED',
    createdAt: '2026-10-16T12:00:00.000Z',
    pickupAddress: 'Pickup',
    dropoffAddress: 'Drop-off',
    ...overrides,
  };
}

const deliveries = [
  delivery('far-new', { createdAt: '2026-10-18T12:00:00.000Z', distanceMeters: 5_000, offeredPrice: '4.00' }),
  delivery('near-old', { createdAt: '2026-10-16T12:00:00.000Z', distanceMeters: 800, suggestedPrice: '9.00' }),
  delivery('unknown', { createdAt: '2026-10-17T12:00:00.000Z' }),
];

describe('delivery list sort', () => {
  it('orders newest or oldest by date', () => {
    expect(sortDeliveries(deliveries, 'newest').map((item) => item.id)).toEqual(['far-new', 'unknown', 'near-old']);
    expect(sortDeliveries(deliveries, 'oldest').map((item) => item.id)).toEqual(['near-old', 'unknown', 'far-new']);
  });

  it('orders the shortest or longest distance and leaves an unknown distance last', () => {
    expect(sortDeliveries(deliveries, 'shortest').map((item) => item.id)).toEqual(['near-old', 'far-new', 'unknown']);
    expect(sortDeliveries(deliveries, 'longest').map((item) => item.id)).toEqual(['far-new', 'near-old', 'unknown']);
  });

  it('orders the highest or lowest price and uses the suggestion when no price is agreed', () => {
    expect(sortDeliveries(deliveries, 'highest').map((item) => item.id)).toEqual(['near-old', 'far-new', 'unknown']);
    expect(sortDeliveries(deliveries, 'lowest').map((item) => item.id)).toEqual(['far-new', 'near-old', 'unknown']);
  });
});
