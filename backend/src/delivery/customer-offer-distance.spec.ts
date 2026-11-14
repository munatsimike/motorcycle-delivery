import { describe, expect, it } from 'vitest';

import { Prisma } from '../generated/prisma/client.js';
import { CUSTOMER_OFFER_LOCATION_FRESH_MS, knownRiderPoint, pickupDistanceMeters } from './customer-offer-distance.js';

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

  it('turns a stored Prisma Decimal fix into numeric coordinates', () => {
    const point = knownRiderPoint({
      latitude: new Prisma.Decimal('-17.8240000'),
      longitude: new Prisma.Decimal('31.0500000'),
    });
    expect(point).toEqual({ latitude: -17.824, longitude: 31.05 });
    expect(typeof point?.latitude).toBe('number');
    expect(typeof point?.longitude).toBe('number');
    expect(knownRiderPoint({ latitude: -17.824, longitude: 31.05 })).toEqual({ latitude: -17.824, longitude: 31.05 });
    expect(knownRiderPoint({ latitude: '-17.824', longitude: '31.05' })).toEqual({ latitude: -17.824, longitude: 31.05 });
    expect(knownRiderPoint(null)).toBeNull();
    expect(knownRiderPoint({ latitude: null, longitude: 31.05 })).toBeNull();
    expect(knownRiderPoint({ latitude: Number.NaN, longitude: 31.05 })).toBeNull();
    expect(knownRiderPoint({ latitude: Number.POSITIVE_INFINITY, longitude: 31.05 })).toBeNull();
    expect(knownRiderPoint({ latitude: 'south', longitude: '31.05' })).toBeNull();
    expect(knownRiderPoint({ latitude: new Prisma.Decimal('91'), longitude: new Prisma.Decimal('31.05') })).toBeNull();
    expect(knownRiderPoint({ latitude: new Prisma.Decimal('-17.8'), longitude: new Prisma.Decimal('181') })).toBeNull();
    expect(knownRiderPoint({ latitude: new Prisma.Decimal('-90'), longitude: new Prisma.Decimal('180') })).toEqual({ latitude: -90, longitude: 180 });
  });

  it('keeps a stale stored fix on the map and hides it from pickup distance', () => {
    expect(knownRiderPoint({
      latitude: new Prisma.Decimal('-17.8000000'),
      longitude: new Prisma.Decimal('31.0400000'),
    })).toEqual({ latitude: -17.8, longitude: 31.04 });
    expect(pickupDistanceMeters(
      new Prisma.Decimal('-17.8292000'),
      new Prisma.Decimal('31.0522000'),
      {
        latitude: new Prisma.Decimal('-17.8240000'),
        longitude: new Prisma.Decimal('31.0500000'),
        updatedAt: new Date(NOW.getTime() - CUSTOMER_OFFER_LOCATION_FRESH_MS - 1),
      },
      NOW,
    )).toBeNull();
    expect(pickupDistanceMeters(
      new Prisma.Decimal('-17.8292000'),
      new Prisma.Decimal('31.0522000'),
      {
        latitude: new Prisma.Decimal('-17.8240000'),
        longitude: new Prisma.Decimal('31.0500000'),
        updatedAt: NOW,
      },
      NOW,
    )).toBeGreaterThan(0);
  });
});
