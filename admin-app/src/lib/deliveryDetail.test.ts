import { describe, expect, it } from 'vitest';
import { agreedBidAmount, commissionPercent, commissionStateLabel, commissionStateTime } from './deliveryDetail';
import type { AdminAcceptance, DeliveryDetail } from './types';

function acceptance(patch: Partial<AdminAcceptance> = {}): AdminAcceptance {
  return {
    assignmentId: 'assignment-1',
    assignmentStatus: 'ACCEPTED',
    riderProfileId: 'rider-1',
    riderName: 'Tariro Moyo',
    acceptedBidId: 'bid-1',
    acceptedAt: '2026-10-24T11:05:00.000Z',
    bidAmount: '9.50',
    currency: 'USD',
    basisPoints: 1000,
    rateVersion: 3,
    commissionAmount: '0.95',
    reservation: {
      id: 'reservation-1',
      assignmentId: 'assignment-1',
      amount: '0.95',
      currency: 'USD',
      status: 'OPEN',
      createdAt: '2026-10-24T11:05:00.000Z',
      releasedAt: null,
      capturedAt: null,
    },
    commissionState: 'RESERVED',
    ...patch,
  };
}

function delivery(patch: Partial<DeliveryDetail> = {}): DeliveryDetail {
  return {
    deliveryId: 'delivery-1',
    deliveryType: 'PARCEL',
    status: 'RIDER_ASSIGNED',
    pickupAddress: 'Avondale',
    dropoffAddress: 'CBD',
    price: '9.50',
    currency: 'USD',
    paymentMethod: null,
    activeAssignment: { id: 'assignment-1', riderProfileId: 'rider-1', motorcycleId: 'bike-1', status: 'ACCEPTED' },
    createdAt: '2026-10-24T09:00:00.000Z',
    updatedAt: '2026-10-24T11:05:00.000Z',
    parcelSize: 'SMALL',
    suggestedPrice: '8.00',
    distanceMeters: 1000,
    pricingVersion: 4,
    payer: null,
    serviceClass: 'FLEXIBLE',
    deliverBy: '2026-10-24T16:30:00.000Z',
    assignments: [],
    statusTimeline: [],
    bids: [],
    acceptances: [acceptance()],
    unmatchedReservations: [],
    ...patch,
  };
}

describe('delivery detail presentation', () => {
  it('uses the accepted bid as the agreed price', () => {
    expect(agreedBidAmount(delivery())).toBe('9.50');
    expect(agreedBidAmount(delivery({
      price: '8.00',
      activeAssignment: null,
      acceptances: [],
    }))).toBeNull();
  });

  it('formats a snapshotted rate, including zero', () => {
    expect(commissionPercent(1000)).toBe('10.00%');
    expect(commissionPercent(0)).toBe('0.00%');
    expect(commissionPercent(null)).toBe('Rate not recorded');
  });

  it('names each commission state from the stored reservation', () => {
    expect(commissionStateLabel('RESERVED')).toBe('Reserved at acceptance');
    expect(commissionStateLabel('CAPTURED')).toBe('Captured after delivery');
    expect(commissionStateLabel('RELEASED')).toBe('Released after cancellation');
    expect(commissionStateLabel('NOT_RESERVED')).toBe('No commission was reserved');
    expect(commissionStateLabel('UNRECORDED')).toBe('Commission reservation is not recorded');
    expect(commissionStateTime(acceptance({
      commissionState: 'CAPTURED',
      reservation: {
        id: 'reservation-1',
        assignmentId: 'assignment-1',
        amount: '0.95',
        currency: 'USD',
        status: 'CAPTURED',
        createdAt: '2026-10-24T11:05:00.000Z',
        releasedAt: null,
        capturedAt: '2026-10-24T12:00:00.000Z',
      },
    }))).toBe('2026-10-24T12:00:00.000Z');
    expect(commissionStateTime(acceptance({ commissionState: 'NOT_RESERVED', reservation: null }))).toBeNull();
  });
});
