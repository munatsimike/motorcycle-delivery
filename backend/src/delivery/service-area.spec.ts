import { BadRequestException } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { CoordinateSource } from '../generated/prisma/client.js';
import { readDeliveryDraft, readQuotePins } from './delivery-request.js';
import {
  OUTSIDE_SERVICE_AREA,
  coordinateIsServable,
  netherlandsCoordinateBlockers,
  netherlandsCoordinatesAllowed,
} from './service-area.js';

const local = {
  NODE_ENV: 'development',
  ALLOW_TEST_NL_COORDINATES: 'true',
};

describe('service area', () => {
  afterEach(() => {
    delete process.env.ALLOW_TEST_NL_COORDINATES;
  });

  it('accepts Zimbabwe pickup and drop-off coordinates', () => {
    expect(coordinateIsServable(-17.8292, 31.0522)).toBe(true);
    expect(coordinateIsServable(-20.15, 28.5833)).toBe(true);
    expect(coordinateIsServable(-18.9707, 32.6709)).toBe(true);
    expect(coordinateIsServable(-17.9244, 25.8567)).toBe(true);
    expect(coordinateIsServable(-22.2167, 30)).toBe(true);
    expect(coordinateIsServable(-16.5167, 28.8)).toBe(true);
    const pins = readQuotePins({
      pickup: { latitude: -17.8292, longitude: 31.0522 },
      dropoff: { latitude: -20.15, longitude: 28.5833 },
    });
    expect(pins.pickupLatitude).toBe('-17.8292000');
    expect(pins.dropoffLongitude).toBe('28.5833000');
  });

  it('rejects an unsupported production pickup or drop-off', () => {
    expect(coordinateIsServable(52.3676, 4.9041)).toBe(false);
    expect(coordinateIsServable(-26.2041, 28.0473)).toBe(false);
    expect(coordinateIsServable(0, 0)).toBe(false);
    expect(() => readQuotePins({
      pickup: { latitude: 52.3676, longitude: 4.9041 },
      dropoff: { latitude: -17.8292, longitude: 31.0522 },
    })).toThrow(OUTSIDE_SERVICE_AREA);
    expect(() => readQuotePins({
      pickup: { latitude: -17.8292, longitude: 31.0522 },
      dropoff: { latitude: -26.2041, longitude: 28.0473 },
    })).toThrow(OUTSIDE_SERVICE_AREA);
    expect(() => readDeliveryDraft(deliveryBody(52.3676, 4.9041, -17.8292, 31.0522))).toThrow(BadRequestException);
    expect(() => readDeliveryDraft(deliveryBody(-17.8292, 31.0522, 52.35, 4.91))).toThrow(OUTSIDE_SERVICE_AREA);
  });

  it('rejects malformed coordinates before the service-area message', () => {
    expect(() => readQuotePins({
      pickup: { latitude: 'north', longitude: 31 },
      dropoff: { latitude: -17.8, longitude: 31 },
    })).toThrow('Enter a valid pickup location');
    expect(coordinateIsServable(Number.NaN, 31)).toBe(false);
    expect(coordinateIsServable(91, 0)).toBe(false);
  });

  it('allows Netherlands coordinates only for verified local development', () => {
    expect(netherlandsCoordinatesAllowed()).toBe(false);
    expect(netherlandsCoordinatesAllowed(local)).toBe(true);
    expect(coordinateIsServable(52.3676, 4.9041, local)).toBe(true);
    expect(coordinateIsServable(52.35, 4.85, local)).toBe(true);
    const previousNode = process.env.NODE_ENV;
    process.env.ALLOW_TEST_NL_COORDINATES = 'true';
    process.env.NODE_ENV = 'development';
    try {
      const pins = readQuotePins({
        pickup: { latitude: 52.3676, longitude: 4.9041 },
        dropoff: { latitude: 52.35, longitude: 4.85 },
      });
      expect(pins.pickupLatitude).toBe('52.3676000');
      expect(readDeliveryDraft(deliveryBody(52.3676, 4.9041, 52.35, 4.85)).pickupLatitude).toBe('52.3676000');
    } finally {
      process.env.NODE_ENV = previousNode;
    }
  });

  it('keeps the Netherlands exception closed in production and on a hosted process', () => {
    expect(netherlandsCoordinatesAllowed({
      ...local,
      NODE_ENV: 'production',
      RAILWAY_ENVIRONMENT: 'production',
    })).toBe(false);
    expect(coordinateIsServable(52.3676, 4.9041, {
      NODE_ENV: 'production',
      ALLOW_TEST_NL_COORDINATES: 'true',
    })).toBe(false);
    expect(netherlandsCoordinateBlockers({
      ...local,
      RAILWAY_ENVIRONMENT: 'production',
    })).toContain('RAILWAY_ENVIRONMENT');
    expect(netherlandsCoordinateBlockers({
      ...local,
      PUBLIC_URL: 'https://example.com',
    })).toContain('PUBLIC_URL');
    expect(netherlandsCoordinatesAllowed({
      ...local,
      ALLOW_TEST_NL_COORDINATES: 'TRUE',
    })).toBe(false);
    expect(coordinateIsServable(-17.8292, 31.0522, {
      NODE_ENV: 'production',
      ALLOW_TEST_NL_COORDINATES: 'true',
      RAILWAY_ENVIRONMENT: 'production',
    })).toBe(true);
  });
});

function deliveryBody(pickupLatitude: number, pickupLongitude: number, dropoffLatitude: number, dropoffLongitude: number) {
  return {
    pickup: stop(pickupLatitude, pickupLongitude),
    dropoff: stop(dropoffLatitude, dropoffLongitude),
    parcel: { description: 'Documents', size: 'SMALL' },
    offeredPrice: '2.50',
    payer: 'SENDER',
    paymentMethod: 'CASH',
  };
}

function stop(latitude: number, longitude: number) {
  return {
    latitude,
    longitude,
    address: '12 Samora Machel Avenue',
    placeId: null,
    coordinateSource: CoordinateSource.DEVICE_GEOCODER,
    contactName: 'Tendai Moyo',
    contactPhone: '+263771234567',
  };
}
