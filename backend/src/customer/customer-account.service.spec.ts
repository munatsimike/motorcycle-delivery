import { ForbiddenException } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { CustomerAccountKind, UserRole } from '../generated/prisma/client.js';
import { CustomerAccountService } from './customer-account.service.js';

const USER = {
  id: 'user-1',
  role: UserRole.CUSTOMER,
  phone: '+263771234567',
  email: 'rudo@example.com',
  customerAccount: {
    id: 'account-1',
    kind: CustomerAccountKind.INDIVIDUAL,
    name: 'Rudo Ncube',
    contactName: null,
    address: '1 First Street',
  },
};

describe('customer account marketplace signal', () => {
  const previousFlag = process.env.V2_MARKETPLACE_ENABLED;
  afterEach(() => {
    if (previousFlag === undefined) {
      delete process.env.V2_MARKETPLACE_ENABLED;
    } else {
      process.env.V2_MARKETPLACE_ENABLED = previousFlag;
    }
  });

  it('returns the server marketplace flag for the signed-in customer', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const enabled = await new CustomerAccountService(prisma(USER) as never).current({ userId: USER.id });
    expect(enabled.marketplaceEnabled).toBe(true);
    expect(enabled).toMatchObject({
      id: 'account-1',
      kind: 'INDIVIDUAL',
      name: 'Rudo Ncube',
      phone: '+263771234567',
    });
    expect(JSON.stringify(enabled)).not.toContain('V2_MARKETPLACE_ENABLED');

    delete process.env.V2_MARKETPLACE_ENABLED;
    const disabled = await new CustomerAccountService(prisma(USER) as never).current({ userId: USER.id });
    expect(disabled.marketplaceEnabled).toBe(false);
    expect(disabled.phone).toBe('+263771234567');
  });

  it('requires an authenticated customer profile', async () => {
    const accounts = new CustomerAccountService(prisma(null) as never);
    await expect(accounts.current({ userId: 'missing' })).rejects.toBeInstanceOf(ForbiddenException);
    const withoutAccount = new CustomerAccountService(prisma({ ...USER, customerAccount: null }) as never);
    await expect(withoutAccount.current({ userId: USER.id })).rejects.toBeInstanceOf(ForbiddenException);
  });
});

function prisma(user: typeof USER | { customerAccount: null } | null) {
  return {
    user: {
      async findUnique() {
        return user;
      },
    },
  };
}
