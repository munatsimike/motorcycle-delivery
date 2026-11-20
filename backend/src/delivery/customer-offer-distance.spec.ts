import { describe, expect, it } from 'vitest';

import { Prisma, RiderAvailability } from '../generated/prisma/client.js';
import { CUSTOMER_OFFER_LOCATION_FRESH_MS, knownRiderPoint, pickupDistanceMeters } from './customer-offer-distance.js';

const NOW = new Date('2026-10-24T08:00:00.000Z');
const AVAILABLE = { availability: RiderAvailability.AVAILABLE, receivingRequests: true as boolean | null };

function mapPoint(
  location: { latitude: unknown; longitude: unknown; updatedAt?: Date | null } | null,
  rider = AVAILABLE,
  now = NOW,
) {
  return knownRiderPoint(location, now, rider);
}

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

  it('turns a fresh available rider fix into numeric coordinates', () => {
    const point = mapPoint({
      latitude: new Prisma.Decimal('-17.8240000'),
      longitude: new Prisma.Decimal('31.0500000'),
      updatedAt: NOW,
    });
    expect(point).toEqual({ latitude: -17.824, longitude: 31.05 });
    expect(typeof point?.latitude).toBe('number');
    expect(typeof point?.longitude).toBe('number');
    expect(mapPoint({ latitude: -17.824, longitude: 31.05, updatedAt: NOW })).toEqual({ latitude: -17.824, longitude: 31.05 });
    expect(mapPoint({ latitude: '-17.824', longitude: '31.05', updatedAt: new Date(NOW.getTime() - CUSTOMER_OFFER_LOCATION_FRESH_MS + 1) })).toEqual({ latitude: -17.824, longitude: 31.05 });
    expect(mapPoint(null)).toBeNull();
    expect(mapPoint({ latitude: null, longitude: 31.05, updatedAt: NOW })).toBeNull();
    expect(mapPoint({ latitude: Number.NaN, longitude: 31.05, updatedAt: NOW })).toBeNull();
    expect(mapPoint({ latitude: Number.POSITIVE_INFINITY, longitude: 31.05, updatedAt: NOW })).toBeNull();
    expect(mapPoint({ latitude: 'south', longitude: '31.05', updatedAt: NOW })).toBeNull();
    expect(mapPoint({ latitude: new Prisma.Decimal('91'), longitude: new Prisma.Decimal('31.05'), updatedAt: NOW })).toBeNull();
    expect(mapPoint({ latitude: new Prisma.Decimal('-17.8'), longitude: new Prisma.Decimal('181'), updatedAt: NOW })).toBeNull();
    expect(mapPoint({ latitude: new Prisma.Decimal('-90'), longitude: new Prisma.Decimal('180'), updatedAt: NOW })).toEqual({ latitude: -90, longitude: 180 });
    expect(mapPoint({ latitude: -17.824, longitude: 31.05 })).toBeNull();
  });

  it('hides the map point when the fix is stale or the rider is not receiving', () => {
    expect(mapPoint({
      latitude: new Prisma.Decimal('-17.8000000'),
      longitude: new Prisma.Decimal('31.0400000'),
      updatedAt: new Date(NOW.getTime() - CUSTOMER_OFFER_LOCATION_FRESH_MS),
    })).toBeNull();
    expect(mapPoint(
      { latitude: -17.824, longitude: 31.05, updatedAt: NOW },
      { availability: RiderAvailability.OFFLINE, receivingRequests: false },
    )).toBeNull();
    expect(mapPoint(
      { latitude: -17.824, longitude: 31.05, updatedAt: NOW },
      { availability: RiderAvailability.BUSY, receivingRequests: true },
    )).toBeNull();
    expect(mapPoint(
      { latitude: -17.824, longitude: 31.05, updatedAt: NOW },
      { availability: RiderAvailability.AVAILABLE, receivingRequests: false },
    )).toBeNull();
    expect(mapPoint(
      { latitude: -17.824, longitude: 31.05, updatedAt: NOW },
      { availability: RiderAvailability.AVAILABLE, receivingRequests: null },
    )).toBeNull();
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
