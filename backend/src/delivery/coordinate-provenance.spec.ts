import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CoordinateSource } from '../generated/prisma/client.js';
import { readDeliveryDraft } from './delivery-request.js';

const placeId = 'ChIJpickup0001';

function body(pickupSource: string, dropoffSource: string, pickupPlace: string | null, dropoffPlace: string | null) {
  return {
    pickup: stop(pickupSource, pickupPlace, '12 Samora Machel Avenue'),
    dropoff: stop(dropoffSource, dropoffPlace, '4 Jason Moyo Avenue'),
    parcel: { description: 'Documents', size: 'SMALL' },
    offeredPrice: '2.50',
    payer: 'SENDER',
    paymentMethod: 'CASH',
  };
}

function stop(coordinateSource: string, placeIdValue: string | null, address: string) {
  return {
    latitude: '-17.8292',
    longitude: '31.0522',
    address,
    placeId: placeIdValue,
    coordinateSource,
    contactName: 'Tendai Moyo',
    contactPhone: '+263771234567',
  };
}

describe('delivery coordinate provenance', () => {
  it('keeps a Google place id with the coordinate source', () => {
    const draft = readDeliveryDraft(body('GOOGLE_PLACES', 'DEVICE_GEOCODER', placeId, null));
    expect(draft.pickupCoordinateSource).toBe(CoordinateSource.GOOGLE_PLACES);
    expect(draft.pickupPlaceId).toBe(placeId);
    expect(draft.dropoffCoordinateSource).toBe(CoordinateSource.DEVICE_GEOCODER);
    expect(draft.dropoffPlaceId).toBeNull();
  });

  it('rejects an unreviewed source and a Google coordinate without a place id', () => {
    expect(() => readDeliveryDraft(body('UNREVIEWED', 'GOOGLE_PLACES', null, placeId))).toThrow(BadRequestException);
    expect(() => readDeliveryDraft(body('GOOGLE_PLACES', 'DEVICE_GEOCODER', null, null))).toThrow(BadRequestException);
    expect(() => readDeliveryDraft(body('DEVICE_GEOCODER', 'GOOGLE_PLACES', placeId, placeId))).toThrow(BadRequestException);
  });
});
