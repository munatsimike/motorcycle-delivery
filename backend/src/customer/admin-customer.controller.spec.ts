import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AdminCustomerController } from './admin-customer.controller.js';

describe('AdminCustomerController', () => {
  const customers = {
    async list() {
      return { data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
    },
    async getById() {
      return { customerAccountId: 'customer-1' };
    },
    async listDeliveries() {
      return { data: [{ deliveryId: 'delivery-1' }], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } };
    },
  };

  it('requires an admin to list, read, or page a customer', () => {
    const controller = new AdminCustomerController(customers as never);
    expect(() => controller.list({} as never, {})).toThrow(ForbiddenException);
    expect(() => controller.getById({} as never, 'customer-1')).toThrow(ForbiddenException);
    expect(() => controller.deliveries({} as never, 'customer-1', {})).toThrow(ForbiddenException);
  });

  it('lists customers and their deliveries for an admin', async () => {
    const controller = new AdminCustomerController(customers as never);
    const admin = { admin: { userId: 'admin-1' } } as never;
    await expect(controller.list(admin, {})).resolves.toEqual({
      data: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
    await expect(controller.getById(admin, 'customer-1')).resolves.toEqual({ customerAccountId: 'customer-1' });
    await expect(controller.deliveries(admin, 'customer-1', { page: '1' })).resolves.toMatchObject({
      data: [{ deliveryId: 'delivery-1' }],
    });
  });
});
