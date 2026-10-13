import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { UserRole } from '../generated/prisma/client.js';
import { CustomerAccountController } from './customer-account.controller.js';

describe('CustomerAccountController', () => {
  const controller = new CustomerAccountController({
    async activate(session: { userId: string }) {
      return { id: 'account-1', userId: session.userId };
    },
    async current() {
      return { id: 'account-1', phone: '+263771234567' };
    },
  } as never);

  it('requires an authenticated customer session', () => {
    expect(() => controller.activate({}, {})).toThrow(ForbiddenException);
    expect(() => controller.current({})).toThrow(ForbiddenException);
  });

  it('uses the authenticated user and omits storage details', async () => {
    const response = await controller.activate({ customerSession: { userId: 'user-1', role: UserRole.RIDER } }, {
      role: 'ADMIN',
      phone: '+263770000000',
    });
    expect(response).toEqual({ id: 'account-1', userId: 'user-1' });
    expect(JSON.stringify(await controller.current({ customer: { userId: 'user-1', role: UserRole.CUSTOMER, customerAccountId: 'account-1' } })))
      .not.toContain('objectKey');
  });
});
