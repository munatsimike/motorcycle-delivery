import { describe, expect, it } from 'vitest';
import { Currency, DeliveryPayer, DeliveryStatus, ParcelSize, PaymentMethod, CoordinateSource } from '../generated/prisma/client.js';
import { toCustomerDelivery, toRiderDelivery, withCollectingRiderLocation, type StoredDelivery } from './delivery-view.js';

describe('rider delivery view', () => {
  it('omits the suggested price', () => {
    const view = toRiderDelivery(stored());
    expect(view.offeredPrice).toBe('4.00');
    expect(JSON.stringify(view)).not.toContain('suggestedPrice');
    expect(JSON.stringify(view)).not.toContain('1.50');
  });

  it('keeps a present coordinate and returns null when one is missing', () => {
    const present = toCustomerDelivery(stored());
    expect(present.pickup.latitude).toBe('-17.8292000');
    expect(present.dropoff.longitude).toBe('31.0531000');
    const cleared = toCustomerDelivery({
      ...stored(),
      pickupLatitude: null,
      pickupLongitude: null,
    });
    expect(cleared.pickup.latitude).toBeNull();
    expect(cleared.pickup.longitude).toBeNull();
    expect(cleared.dropoff.latitude).toBe('-17.7833000');
    expect(cleared.pickup.address).toBe('12 Samora Machel Avenue');
  });

  it('withholds restored coordinates that are already due for deletion', () => {
    const restored = toCustomerDelivery({
      ...stored(),
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      pickupCoordinateSource: CoordinateSource.GOOGLE_PLACES,
      pickupPlaceId: 'ChIJstreet0001',
      pickupCoordinateRetrievedAt: new Date('2026-08-01T00:00:00.000Z'),
      dropoffCoordinateSource: CoordinateSource.GOOGLE_PLACES,
      dropoffPlaceId: 'ChIJstreet0001',
      dropoffCoordinateRetrievedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    expect(restored.pickup.latitude).toBeNull();
    expect(restored.pickup.longitude).toBeNull();
    expect(restored.dropoff.latitude).toBeNull();
    expect(restored.dropoff.longitude).toBeNull();
    expect(restored.pickup.address).toBe('12 Samora Machel Avenue');
    expect(restored.dropoff.address).toBe('4 Jason Moyo Avenue');
    expect(restored.offeredPrice).toBe('4.00');
    expect(restored.status).toBe(DeliveryStatus.CREATED);
  });

  it('adds the rider point only while the delivery is collecting', () => {
    const point = { latitude: '-17.8010000', longitude: '31.1090000' };
    for (const status of [
      DeliveryStatus.RIDER_ASSIGNED,
      DeliveryStatus.COLLECTED,
      DeliveryStatus.OUT_FOR_DELIVERY,
      DeliveryStatus.DELIVERED,
      DeliveryStatus.CANCELLED,
      DeliveryStatus.ASSIGNED,
      DeliveryStatus.IN_TRANSIT,
    ]) {
      const hidden = withCollectingRiderLocation(toCustomerDelivery({ ...stored(), status }), point);
      expect(hidden).not.toHaveProperty('riderLocation');
      expect(JSON.stringify(hidden)).not.toContain('-17.8010000');
    }
    const visible = withCollectingRiderLocation(
      toCustomerDelivery({ ...stored(), status: DeliveryStatus.COLLECTING }),
      point,
    );
    expect(visible).toMatchObject({ status: 'COLLECTING', riderLocation: point });
    expect(withCollectingRiderLocation(
      toCustomerDelivery({ ...stored(), status: DeliveryStatus.COLLECTING }),
      null,
    )).not.toHaveProperty('riderLocation');
    expect(toRiderDelivery({ ...stored(), status: DeliveryStatus.COLLECTING })).not.toHaveProperty('riderLocation');
  });
});

function stored(): StoredDelivery {
  return {
    id: 'delivery-1',
    status: DeliveryStatus.CREATED,
    currency: Currency.USD,
    payer: DeliveryPayer.SENDER,
    paymentMethod: PaymentMethod.CASH,
    distanceMeters: 1200,
    pricingVersion: 3,
    price: '4.00',
    suggestedPrice: '1.50',
    pickupLatitude: '-17.8292000',
    pickupLongitude: '31.0522000',
    pickupAddress: '12 Samora Machel Avenue',
    pickupLandmark: null,
    pickupInstructions: null,
    pickupContactName: 'Tendai Moyo',
    pickupContactPhone: '+263771234567',
    dropoffLatitude: '-17.7833000',
    dropoffLongitude: '31.0531000',
    dropoffAddress: '4 Jason Moyo Avenue',
    dropoffLandmark: null,
    dropoffInstructions: null,
    recipientName: 'Rudo Ncube',
    recipientPhone: '+263777654321',
    parcelDescription: 'Documents',
    parcelSize: ParcelSize.MEDIUM,
    parcelInstructions: null,
  };
}
