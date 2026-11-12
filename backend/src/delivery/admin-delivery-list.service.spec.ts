import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AdminDeliveryListService } from './admin-delivery-list.service.js';

const DELIVERY_ID = '018f1a00-0000-7000-8000-000000000001';

describe('AdminDeliveryListService detail', () => {
  it('rejects an invalid id before querying', async () => {
    let queried = false;
    const service = new AdminDeliveryListService({
      delivery: { async findUnique() { queried = true; return null; } },
    } as never);
    await expect(service.getById('delivery-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(queried).toBe(false);
  });

  it('returns not found when the delivery is absent', async () => {
    const service = new AdminDeliveryListService({
      delivery: { async findUnique() { return null; } },
    } as never);
    await expect(service.getById(DELIVERY_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('maps the stored row and leaves the list query unchanged', async () => {
    const createdAt = new Date('2026-10-24T09:00:00.000Z');
    let listSelect: unknown;
    const service = new AdminDeliveryListService({
      $transaction(operations: unknown[]) {
        return Promise.all(operations);
      },
      delivery: {
        count() {
          return Promise.resolve(1);
        },
        findMany(args: { select: unknown }) {
          listSelect = args.select;
          return Promise.resolve([]);
        },
        findUnique() {
          return Promise.resolve({
            id: DELIVERY_ID,
            deliveryType: 'PARCEL',
            status: 'CREATED',
            pickupAddress: 'Avondale',
            dropoffAddress: 'CBD',
            parcelSize: 'SMALL',
            price: null,
            suggestedPrice: '8.00',
            distanceMeters: 1000,
            pricingVersion: 4,
            payer: null,
            currency: 'USD',
            paymentMethod: null,
            serviceClass: 'FLEXIBLE',
            deliverBy: null,
            createdAt,
            updatedAt: createdAt,
            statusEvents: [],
            assignments: [],
            bids: [],
            feeReservations: [],
          });
        },
      },
    } as never);

    const detail = await service.getById(DELIVERY_ID);
    expect(detail.serviceClass).toBe('FLEXIBLE');
    expect(detail.suggestedPrice).toBe('8.00');
    expect(detail.price).toBeNull();
    expect(detail.bids).toEqual([]);
    expect(detail.acceptances).toEqual([]);

    await service.list({});
    expect(JSON.stringify(listSelect)).not.toContain('bids');
    expect(JSON.stringify(listSelect)).not.toContain('serviceClass');
  });
});
