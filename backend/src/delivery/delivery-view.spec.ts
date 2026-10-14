import { describe, expect, it } from 'vitest';
import { Currency, DeliveryPayer, DeliveryStatus, ParcelSize, PaymentMethod } from '../generated/prisma/client.js';
import { toRiderDelivery, type StoredDelivery } from './delivery-view.js';

describe('rider delivery view', () => {
  it('omits the suggested price', () => {
    const view = toRiderDelivery(stored());
    expect(view.offeredPrice).toBe('4.00');
    expect(JSON.stringify(view)).not.toContain('suggestedPrice');
    expect(JSON.stringify(view)).not.toContain('1.50');
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
