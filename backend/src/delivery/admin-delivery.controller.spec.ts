import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AdminDeliveryController } from './admin-delivery.controller.js';

describe('AdminDeliveryController', () => {
  const deliveries = {
    async list() {
      return { data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
    },
    async getById(deliveryId: string) {
      return { deliveryId, serviceClass: null };
    },
  };

  it('requires an admin for the delivery list and detail', () => {
    const controller = new AdminDeliveryController(deliveries as never);
    expect(() => controller.list({}, {})).toThrow(ForbiddenException);
    expect(() => controller.getById({}, '018f1a00-0000-7000-8000-000000000001')).toThrow(ForbiddenException);
  });

  it('reads one delivery for an admin', async () => {
    const controller = new AdminDeliveryController(deliveries as never);
    await expect(controller.getById(
      { admin: { userId: 'admin-1' } } as never,
      '018f1a00-0000-7000-8000-000000000001',
    )).resolves.toEqual({
      deliveryId: '018f1a00-0000-7000-8000-000000000001',
      serviceClass: null,
    });
  });
});
