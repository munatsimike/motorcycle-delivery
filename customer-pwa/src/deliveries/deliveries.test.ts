import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTIVE_LIST_STATUSES,
  deliveryCanSearchAgain,
  deliveryCardAddress,
  deliveryCardStatusLabel,
  deliveryContentKind,
  deliveryDistanceLabel,
  deliveryGroup,
  deliveryOutcomeSupport,
  deliveryOutcomeTitle,
  deliveryWhenLabel,
  moneyLabel,
  readCustomerDeliveryPage,
  shortDeliveryReference,
  sortDeliveries,
  type CustomerDelivery,
} from './rules.ts';

function delivery(overrides: Partial<CustomerDelivery> = {}): CustomerDelivery {
  return {
    id: 'delivery-1',
    status: 'SEARCHING',
    createdAt: '2026-11-13T08:00:00.000Z',
    pickupAddress: '12 Samora Machel Avenue, Harare, Zimbabwe',
    dropoffAddress: '4 Jason Moyo Street, Harare, Zimbabwe',
    serviceClass: null,
    deliverBy: null,
    currency: 'USD',
    suggestedPrice: '3.00',
    offeredPrice: '4.50',
    distanceMeters: 1200,
    parcelDescription: 'Parcel',
    openBidCount: 0,
    ...overrides,
  };
}

test('active and history use the native status groups', () => {
  assert.equal(deliveryGroup('SEARCHING'), 'active');
  assert.equal(deliveryGroup('DELIVERED'), 'history');
  assert.equal(deliveryGroup('CANCELLED'), 'history');
  assert.ok(ACTIVE_LIST_STATUSES.includes('NO_RIDER_FOUND'));
  assert.equal(ACTIVE_LIST_STATUSES.includes('DELIVERED'), false);
});

test('card status, search again, content, and address follow the native rules', () => {
  assert.equal(deliveryCardStatusLabel(delivery({ status: 'CREATED', serviceClass: 'FLEXIBLE' })), 'Waiting for offers');
  assert.equal(deliveryCardStatusLabel(delivery({ status: 'CREATED', serviceClass: 'EXPRESS', openBidCount: 2 })), '2 offers received');
  assert.equal(deliveryCardStatusLabel(delivery({ status: 'COLLECTED' })), 'In transit');
  assert.equal(deliveryCanSearchAgain(delivery({ status: 'NO_RIDER_FOUND', serviceClass: 'EXPRESS', deliverBy: null })), true);
  assert.equal(deliveryCanSearchAgain(delivery({ status: 'NO_RIDER_FOUND', serviceClass: null })), false);
  assert.equal(deliveryContentKind('documents'), 'document');
  assert.equal(deliveryContentKind('food'), 'food');
  assert.equal(deliveryCardAddress('12 Samora Machel Avenue, Harare, Zimbabwe'), '12 Samora Machel Ave');
  assert.equal(shortDeliveryReference('delivery-1'), '#VERY1');
  assert.equal(deliveryOutcomeTitle('PICKED_UP'), 'In transit');
  assert.equal(deliveryOutcomeTitle('CANCELLED'), 'Cancelled');
  assert.match(deliveryOutcomeSupport('NO_RIDER_FOUND'), /No rider was available/);
  assert.equal(deliveryDistanceLabel(850), '850 m');
  assert.equal(deliveryDistanceLabel(1200), '1.2 km');
  assert.equal(moneyLabel('USD', '4.50'), '$4.50');
  const when = deliveryWhenLabel('2026-11-13T08:05:00.000Z');
  assert.match(when, /13 Nov 2026 • \d{2}:\d{2}/);
});

test('deliveries sort by newest date and read the list payload', () => {
  const older = delivery({ id: 'a', createdAt: '2026-11-12T08:00:00.000Z' });
  const newer = delivery({ id: 'b', createdAt: '2026-11-13T08:00:00.000Z' });
  assert.deepEqual(sortDeliveries([older, newer], 'newest').map((item) => item.id), ['b', 'a']);
  const page = readCustomerDeliveryPage({
    data: [{
      id: 'delivery-1',
      reference: 'R-1',
      status: 'SEARCHING',
      createdAt: '2026-11-13T08:00:00.000Z',
      pickup: { address: 'Pickup' },
      dropoff: { address: 'Dropoff' },
      currency: 'USD',
      suggestedPrice: '3.00',
      offeredPrice: null,
      distanceMeters: 10,
      parcel: { description: 'Food' },
      openBidCount: 0,
    }],
    pagination: { page: 1, totalPages: 2 },
  });
  assert.equal(page.deliveries[0]?.parcelDescription, 'Food');
  assert.equal(page.totalPages, 2);
  assert.throws(() => readCustomerDeliveryPage({ data: [], pagination: { page: 1 } }), /unavailable/);
});
