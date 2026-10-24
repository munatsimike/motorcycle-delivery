import { describe, expect, it } from 'vitest';
import {
  ADMIN_DELIVERY_DETAIL_SELECT,
  toAdminDeliveryDetail,
  type AdminDeliverySource,
} from './admin-delivery-detail.js';

const DELIVERY_ID = '018f1a00-0000-7000-8000-000000000001';
const at = (iso: string) => new Date(iso);

function rider(name: string) {
  return { user: { fullName: name } };
}

function assignment(patch: Partial<AdminDeliverySource['assignments'][number]> = {}): AdminDeliverySource['assignments'][number] {
  return {
    id: '018f1a00-0000-7000-8000-0000000000a1',
    riderProfileId: '018f1a00-0000-7000-8000-0000000000r1',
    motorcycleId: '018f1a00-0000-7000-8000-0000000000m1',
    status: 'ACCEPTED',
    offerExpiresAt: at('2026-10-24T10:00:00.000Z'),
    respondedAt: at('2026-10-24T10:05:00.000Z'),
    releaseReason: null,
    releasedAt: null,
    createdAt: at('2026-10-24T10:00:00.000Z'),
    serviceClass: null,
    acceptedBidAmount: null,
    acceptedCommissionBasisPoints: null,
    acceptedV2CommissionRateVersion: null,
    acceptedCommissionAmount: null,
    acceptedBidId: null,
    riderProfile: rider('Tariro Moyo'),
    ...patch,
  };
}

function source(patch: Partial<AdminDeliverySource> = {}): AdminDeliverySource {
  return {
    id: DELIVERY_ID,
    deliveryType: 'PARCEL',
    status: 'ASSIGNED',
    pickupAddress: 'Avondale',
    dropoffAddress: 'CBD',
    parcelSize: 'SMALL',
    price: '5.00',
    suggestedPrice: '5.00',
    distanceMeters: 1200,
    pricingVersion: 4,
    payer: 'SENDER',
    currency: 'USD',
    paymentMethod: 'CASH',
    serviceClass: null,
    deliverBy: null,
    createdAt: at('2026-10-24T09:00:00.000Z'),
    updatedAt: at('2026-10-24T10:05:00.000Z'),
    statusEvents: [
      {
        id: '018f1a00-0000-7000-8000-0000000000e1',
        previousStatus: null,
        newStatus: 'CREATED',
        actorType: 'CUSTOMER',
        occurredAt: at('2026-10-24T09:00:00.000Z'),
      },
    ],
    assignments: [assignment()],
    bids: [],
    feeReservations: [],
    ...patch,
  };
}

function bid(patch: Partial<AdminDeliverySource['bids'][number]>): AdminDeliverySource['bids'][number] {
  return {
    id: '018f1a00-0000-7000-8000-0000000000b1',
    riderProfileId: '018f1a00-0000-7000-8000-0000000000r1',
    amount: '9.00',
    currency: 'USD',
    status: 'OPEN',
    closedAt: null,
    createdAt: at('2026-10-24T11:00:00.000Z'),
    riderProfile: rider('Tariro Moyo'),
    ...patch,
  };
}

function reservation(patch: Partial<AdminDeliverySource['feeReservations'][number]>): AdminDeliverySource['feeReservations'][number] {
  return {
    id: '018f1a00-0000-7000-8000-0000000000f1',
    assignmentId: '018f1a00-0000-7000-8000-0000000000a1',
    amount: '0.90',
    currency: 'USD',
    status: 'OPEN',
    createdAt: at('2026-10-24T11:05:00.000Z'),
    releasedAt: null,
    capturedAt: null,
    ...patch,
  };
}

function v2Acceptance(patch: Partial<AdminDeliverySource['assignments'][number]> = {}) {
  return assignment({
    serviceClass: 'FLEXIBLE',
    acceptedBidAmount: '9.50',
    acceptedCommissionBasisPoints: 1000,
    acceptedV2CommissionRateVersion: 3,
    acceptedCommissionAmount: '0.95',
    acceptedBidId: '018f1a00-0000-7000-8000-0000000000b1',
    respondedAt: at('2026-10-24T11:05:00.000Z'),
    ...patch,
  });
}

describe('admin delivery detail', () => {
  it('keeps the read select free of secrets and contact details', () => {
    const select = JSON.stringify(ADMIN_DELIVERY_DETAIL_SELECT);
    expect(select).not.toContain('phone');
    expect(select).not.toContain('idempotency');
    expect(select).not.toContain('payloadHash');
    expect(select).not.toContain('password');
    expect(select).not.toContain('email');
  });

  it('preserves a V1 delivery without V2 facts', () => {
    const row = source();
    (row.assignments[0]?.riderProfile.user as { phone?: string }).phone = '+263771111111';
    const detail = toAdminDeliveryDetail(row);

    expect(detail.deliveryId).toBe(DELIVERY_ID);
    expect(detail.price).toBe('5.00');
    expect(detail.suggestedPrice).toBe('5.00');
    expect(detail.paymentMethod).toBe('CASH');
    expect(detail.payer).toBe('SENDER');
    expect(detail.serviceClass).toBeNull();
    expect(detail.deliverBy).toBeNull();
    expect(detail.bids).toEqual([]);
    expect(detail.acceptances).toEqual([]);
    expect(detail.statusTimeline).toEqual(row.statusEvents);
    expect(detail.activeAssignment).toMatchObject({
      id: row.assignments[0]?.id,
      riderName: 'Tariro Moyo',
      status: 'ACCEPTED',
    });
    expect(JSON.stringify(detail)).not.toContain('+263');
    expect(JSON.stringify(detail)).not.toContain('idempotency');
  });

  it('reports a Flexible delivery with the suggested price and the accepted bid', () => {
    const detail = toAdminDeliveryDetail(source({
      status: 'RIDER_ASSIGNED',
      serviceClass: 'FLEXIBLE',
      deliverBy: at('2026-10-24T18:30:00.000Z'),
      price: '9.50',
      suggestedPrice: '8.00',
      payer: null,
      paymentMethod: null,
      assignments: [v2Acceptance({ serviceClass: 'FLEXIBLE' })],
      bids: [bid({ id: '018f1a00-0000-7000-8000-0000000000b1', amount: '9.50', status: 'ACCEPTED' })],
      feeReservations: [reservation({ amount: '0.95' })],
    }));

    expect(detail.serviceClass).toBe('FLEXIBLE');
    expect(detail.deliverBy).toEqual(at('2026-10-24T18:30:00.000Z'));
    expect(detail.suggestedPrice).toBe('8.00');
    expect(detail.price).toBe('9.50');
    expect(detail.acceptances[0]).toMatchObject({
      bidAmount: '9.50',
      basisPoints: 1000,
      rateVersion: 3,
      commissionAmount: '0.95',
      commissionState: 'RESERVED',
      acceptedAt: at('2026-10-24T11:05:00.000Z'),
    });
    expect(detail.bids[0]).toMatchObject({ status: 'ACCEPTED', accepted: true, amount: '9.50' });
  });

  it('reports an Express delivery the same way', () => {
    const detail = toAdminDeliveryDetail(source({
      serviceClass: 'EXPRESS',
      assignments: [v2Acceptance({ serviceClass: 'EXPRESS' })],
      bids: [bid({ status: 'ACCEPTED', amount: '9.50' })],
      feeReservations: [reservation({ amount: '0.95' })],
    }));
    expect(detail.serviceClass).toBe('EXPRESS');
    expect(detail.acceptances[0]?.bidAmount).toBe('9.50');
  });

  it('keeps every bid status and marks only the accepted bid', () => {
    const sameTime = at('2026-10-24T11:00:00.000Z');
    const detail = toAdminDeliveryDetail(source({
      serviceClass: 'FLEXIBLE',
      assignments: [v2Acceptance()],
      bids: [
        bid({ id: '018f1a00-0000-7000-8000-0000000000b3', status: 'OPEN', amount: '11.00', createdAt: sameTime, riderProfile: rider('Chipo Ncube') }),
        bid({ id: '018f1a00-0000-7000-8000-0000000000b1', status: 'ACCEPTED', amount: '9.50', createdAt: sameTime }),
        bid({ id: '018f1a00-0000-7000-8000-0000000000b2', status: 'WITHDRAWN', amount: '10.00', createdAt: at('2026-10-24T11:02:00.000Z') }),
        bid({ id: '018f1a00-0000-7000-8000-0000000000b4', status: 'SUPERSEDED', amount: '12.00', createdAt: at('2026-10-24T11:03:00.000Z') }),
        bid({ id: '018f1a00-0000-7000-8000-0000000000b5', status: 'EXPIRED', amount: '13.00', createdAt: at('2026-10-24T11:04:00.000Z') }),
      ],
    }));

    expect(detail.bids.map((item) => item.status)).toEqual([
      'ACCEPTED',
      'OPEN',
      'WITHDRAWN',
      'SUPERSEDED',
      'EXPIRED',
    ]);
    expect(detail.bids.map((item) => item.accepted)).toEqual([true, false, false, false, false]);
    expect(detail.bids.map((item) => item.id)).toEqual([
      '018f1a00-0000-7000-8000-0000000000b1',
      '018f1a00-0000-7000-8000-0000000000b3',
      '018f1a00-0000-7000-8000-0000000000b2',
      '018f1a00-0000-7000-8000-0000000000b4',
      '018f1a00-0000-7000-8000-0000000000b5',
    ]);
  });

  it('uses the reservation status for reserved, captured, and released commission', () => {
    const reserved = toAdminDeliveryDetail(source({
      serviceClass: 'FLEXIBLE',
      status: 'COLLECTING',
      assignments: [v2Acceptance()],
      feeReservations: [reservation({ status: 'OPEN' })],
    }));
    expect(reserved.acceptances[0]?.commissionState).toBe('RESERVED');

    const captured = toAdminDeliveryDetail(source({
      serviceClass: 'FLEXIBLE',
      status: 'DELIVERED',
      assignments: [v2Acceptance({ status: 'COMPLETED' })],
      feeReservations: [reservation({
        status: 'CAPTURED',
        capturedAt: at('2026-10-24T12:00:00.000Z'),
      })],
    }));
    expect(captured.acceptances[0]?.commissionState).toBe('CAPTURED');
    expect(captured.acceptances[0]?.reservation?.capturedAt).toEqual(at('2026-10-24T12:00:00.000Z'));

    const released = toAdminDeliveryDetail(source({
      serviceClass: 'FLEXIBLE',
      status: 'CREATED',
      price: null,
      assignments: [v2Acceptance({ status: 'CANCELLED', releaseReason: 'RIDER_CANCELLED' })],
      feeReservations: [reservation({
        status: 'RELEASED',
        releasedAt: at('2026-10-24T11:20:00.000Z'),
      })],
    }));
    expect(released.acceptances[0]?.commissionState).toBe('RELEASED');
    expect(released.price).toBeNull();
    expect(released.suggestedPrice).toBe('5.00');
  });

  it('does not treat a completed delivery as captured when the reservation is still open', () => {
    const detail = toAdminDeliveryDetail(source({
      serviceClass: 'EXPRESS',
      status: 'DELIVERED',
      assignments: [v2Acceptance({ status: 'COMPLETED' })],
      feeReservations: [reservation({ status: 'OPEN', capturedAt: null })],
      statusEvents: [],
    }));
    expect(detail.acceptances[0]?.commissionState).toBe('RESERVED');
    expect(detail.statusTimeline).toEqual([]);
  });

  it('records a zero-percent commission without a reservation', () => {
    const detail = toAdminDeliveryDetail(source({
      serviceClass: 'FLEXIBLE',
      assignments: [v2Acceptance({
        acceptedCommissionBasisPoints: 0,
        acceptedCommissionAmount: '0.00',
      })],
      feeReservations: [],
    }));
    expect(detail.acceptances[0]).toMatchObject({
      basisPoints: 0,
      commissionAmount: '0.00',
      commissionState: 'NOT_RESERVED',
      reservation: null,
    });
  });

  it('leaves a positive commission unrecorded when no reservation exists', () => {
    const detail = toAdminDeliveryDetail(source({
      serviceClass: 'FLEXIBLE',
      status: 'DELIVERED',
      assignments: [v2Acceptance({ status: 'COMPLETED' })],
      feeReservations: [],
    }));
    expect(detail.acceptances[0]?.commissionState).toBe('UNRECORDED');
  });

  it('keeps historical bids and the closed acceptance after a request reopens', () => {
    const detail = toAdminDeliveryDetail(source({
      serviceClass: 'FLEXIBLE',
      status: 'CREATED',
      price: null,
      suggestedPrice: '8.00',
      assignments: [
        v2Acceptance({
          id: '018f1a00-0000-7000-8000-0000000000a2',
          status: 'ACCEPTED',
          acceptedBidId: '018f1a00-0000-7000-8000-0000000000b6',
          acceptedBidAmount: '10.00',
          respondedAt: at('2026-10-24T12:00:00.000Z'),
          createdAt: at('2026-10-24T12:00:00.000Z'),
        }),
        v2Acceptance({
          status: 'CANCELLED',
          respondedAt: at('2026-10-24T11:05:00.000Z'),
          createdAt: at('2026-10-24T11:05:00.000Z'),
        }),
      ],
      bids: [
        bid({
          id: '018f1a00-0000-7000-8000-0000000000b1',
          status: 'ACCEPTED',
          amount: '9.50',
          closedAt: at('2026-10-24T11:20:00.000Z'),
          createdAt: at('2026-10-24T11:00:00.000Z'),
        }),
        bid({
          id: '018f1a00-0000-7000-8000-0000000000b4',
          status: 'SUPERSEDED',
          amount: '11.00',
          createdAt: at('2026-10-24T11:01:00.000Z'),
        }),
        bid({
          id: '018f1a00-0000-7000-8000-0000000000b6',
          status: 'OPEN',
          amount: '10.00',
          createdAt: at('2026-10-24T11:30:00.000Z'),
          riderProfile: rider('Chipo Ncube'),
        }),
      ],
      feeReservations: [
        reservation({ status: 'RELEASED', releasedAt: at('2026-10-24T11:20:00.000Z') }),
      ],
    }));

    expect(detail.bids.map((item) => [item.status, item.amount, item.closedAt?.toISOString() ?? null])).toEqual([
      ['ACCEPTED', '9.50', '2026-10-24T11:20:00.000Z'],
      ['SUPERSEDED', '11.00', null],
      ['OPEN', '10.00', null],
    ]);
    expect(detail.acceptances.map((item) => item.assignmentStatus)).toEqual(['CANCELLED', 'ACCEPTED']);
    expect(detail.acceptances[0]?.commissionState).toBe('RELEASED');
    expect(detail.activeAssignment?.id).toBe('018f1a00-0000-7000-8000-0000000000a2');
  });

  it('copies only stored status events', () => {
    const detail = toAdminDeliveryDetail(source({
      serviceClass: 'EXPRESS',
      status: 'DELIVERED',
      statusEvents: [
        {
          id: '018f1a00-0000-7000-8000-0000000000e2',
          previousStatus: 'CREATED',
          newStatus: 'RIDER_ASSIGNED',
          actorType: 'CUSTOMER',
          occurredAt: at('2026-10-24T11:05:00.000Z'),
        },
        {
          id: '018f1a00-0000-7000-8000-0000000000e1',
          previousStatus: null,
          newStatus: 'CREATED',
          actorType: 'CUSTOMER',
          occurredAt: at('2026-10-24T11:05:00.000Z'),
        },
      ],
    }));
    expect(detail.statusTimeline.map((event) => event.newStatus)).toEqual(['CREATED', 'RIDER_ASSIGNED']);
    expect(detail.statusTimeline.map((event) => event.newStatus)).not.toContain('DELIVERED');
  });

  it('returns an empty bid list and leaves optional acceptance fields null', () => {
    const detail = toAdminDeliveryDetail(source({
      serviceClass: 'FLEXIBLE',
      status: 'CREATED',
      price: null,
      deliverBy: null,
      bids: [],
      assignments: [],
      statusEvents: [],
    }));
    expect(detail.bids).toEqual([]);
    expect(detail.acceptances).toEqual([]);
    expect(detail.deliverBy).toBeNull();
    expect(detail.activeAssignment).toBeNull();
    expect(detail.statusTimeline).toEqual([]);
  });
});
