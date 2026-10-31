import { describe, expect, it } from 'vitest';

import { CUSTOMER_OFFER_LOCATION_FRESH_MS, pickupDistanceMeters } from './customer-offer-distance.js';

const NOW = new Date('2026-10-24T08:00:00.000Z');

describe('customer offer distance', () => {
  it('measures a fresh rider location to the pickup and drops a stale one', () => {
    const fresh = pickupDistanceMeters(-17.8292, 31.0522, {
      latitude: -17.824,
      longitude: 31.05,
      updatedAt: new Date(NOW.getTime() - CUSTOMER_OFFER_LOCATION_FRESH_MS),
    }, NOW);
    expect(fresh).toBeGreaterThan(0);
    expect(pickupDistanceMeters(-17.8292, 31.0522, {
      latitude: -17.824,
      longitude: 31.05,
      updatedAt: new Date(NOW.getTime() - CUSTOMER_OFFER_LOCATION_FRESH_MS - 1),
    }, NOW)).toBeNull();
    expect(pickupDistanceMeters(null, 31.0522, {
      latitude: -17.824,
      longitude: 31.05,
      updatedAt: NOW,
    }, NOW)).toBeNull();
    expect(pickupDistanceMeters(-17.8292, 31.0522, null, NOW)).toBeNull();
  });
});
