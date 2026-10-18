import { describe, expect, it } from 'vitest';

import {
  ACTIVE_DELIVERY_STATUSES,
  DELIVERY_STATUSES,
  HISTORY_DELIVERY_STATUSES,
  deliveriesInGroup,
  deliveryGroup,
  deliveryStatusLabel,
  deliveryUsesPackageIcon,
  type CustomerDelivery,
} from './deliveryStatus';

describe('deliveryGroup', () => {
  it('keeps nonterminal statuses active', () => {
    expect(deliveryGroup('CREATED')).toBe('active');
    expect(deliveryGroup('SEARCHING')).toBe('active');
    expect(deliveryGroup('NO_RIDER_FOUND')).toBe('active');
    expect(deliveryGroup('ASSIGNED')).toBe('active');
    expect(deliveryGroup('ARRIVED_AT_PICKUP')).toBe('active');
    expect(deliveryGroup('PICKED_UP')).toBe('active');
    expect(deliveryGroup('IN_TRANSIT')).toBe('active');
    expect(deliveryGroup('ARRIVED_AT_DROPOFF')).toBe('active');
  });

  it('keeps completed, cancelled, and failed deliveries in history', () => {
    expect(deliveryGroup('DELIVERED')).toBe('history');
    expect(deliveryGroup('CANCELLED')).toBe('history');
    expect(deliveryGroup('FAILED')).toBe('history');
  });

  it('places every backend status in exactly one group', () => {
    for (const status of DELIVERY_STATUSES) {
      const groups = [
        ACTIVE_DELIVERY_STATUSES.has(status),
        HISTORY_DELIVERY_STATUSES.has(status),
      ].filter(Boolean);
      expect(groups).toHaveLength(1);
    }
  });
});

describe('deliveriesInGroup', () => {
  const deliveries: CustomerDelivery[] = [
    { id: '1', status: 'IN_TRANSIT', createdAt: '2026-10-16T12:00:00.000Z', pickupAddress: 'A', dropoffAddress: 'B' },
    { id: '2', status: 'DELIVERED', createdAt: '2026-10-16T12:00:00.000Z', pickupAddress: 'C', dropoffAddress: 'D' },
    { id: '3', status: 'CANCELLED', createdAt: '2026-10-16T12:00:00.000Z', pickupAddress: 'E', dropoffAddress: 'F' },
  ];

  it('returns only active deliveries', () => {
    expect(deliveriesInGroup(deliveries, 'active').map((delivery) => delivery.id)).toEqual(['1']);
  });

  it('returns only history deliveries', () => {
    expect(deliveriesInGroup(deliveries, 'history').map((delivery) => delivery.id)).toEqual(['2', '3']);
  });
});

describe('deliveryStatusLabel', () => {
  it('uses the backend status names', () => {
    expect(deliveryStatusLabel('SEARCHING')).toBe('Finding a rider');
    expect(deliveryStatusLabel('ASSIGNED')).toBe('Rider assigned');
    expect(deliveryStatusLabel('NO_RIDER_FOUND')).toBe('No rider found');
    expect(deliveryStatusLabel('PICKED_UP')).toBe('Parcel picked up');
    expect(deliveryStatusLabel('DELIVERED')).toBe('Delivered');
    expect(deliveryStatusLabel('FAILED')).toBe('Failed');
  });
});

describe('deliveryUsesPackageIcon', () => {
  it('uses a package icon for deliveries that are not active', () => {
    expect(deliveryUsesPackageIcon('DELIVERED')).toBe(true);
    expect(deliveryUsesPackageIcon('CANCELLED')).toBe(false);
    expect(deliveryUsesPackageIcon('FAILED')).toBe(true);
    expect(deliveryUsesPackageIcon('SEARCHING')).toBe(false);
    expect(deliveryUsesPackageIcon('IN_TRANSIT')).toBe(false);
  });
});
