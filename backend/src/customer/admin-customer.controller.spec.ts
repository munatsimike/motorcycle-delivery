import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AdminCustomerController } from './admin-customer.controller.js';

describe('AdminCustomerController', () => {
  const customers = {
    async list() {
      return { data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
    },
  };

  it('requires an admin to list customers', () => {
    const controller = new AdminCustomerController(customers as never);
    expect(() => controller.list({} as never, {})).toThrow(ForbiddenException);
  });

  it('lists customers for an admin', async () => {
    const controller = new AdminCustomerController(customers as never);
    await expect(controller.list({ admin: { userId: 'admin-1' } } as never, {})).resolves.toEqual({
      data: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
  });
});
