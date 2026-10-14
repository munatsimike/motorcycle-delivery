import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { UserRole } from '../generated/prisma/client.js';
import { DeliveryController } from './delivery.controller.js';

describe('DeliveryController', () => {
  const controller = new DeliveryController({
    async quote() {
      return { suggestedPrice: '2.00' };
    },
    async create(customer: { customerAccountId: string }) {
      return { customerAccountId: customer.customerAccountId };
    },
  } as never);

  it('requires an authenticated customer account', () => {
    expect(() => controller.quote({}, {})).toThrow(ForbiddenException);
    expect(() => controller.create({}, {})).toThrow(ForbiddenException);
  });

  it('passes the session account to create', async () => {
    const response = await controller.create({
      customer: { userId: 'user-1', role: UserRole.RIDER, customerAccountId: 'account-1' },
    }, { customerId: 'other-account' });
    expect(response).toEqual({ customerAccountId: 'account-1' });
  });
});
