import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';
import { AdminAccessGuard } from '../auth/admin-access.guard.js';
import { WalletBorrowingLimitAuditController, WalletConfigController } from './wallet-config.controller.js';

describe('WalletConfigController', () => {
  const controller = new WalletConfigController({
    async current() {
      return { configVersion: 1 };
    },
    async replace(admin: { userId: string }) {
      return { userId: admin.userId };
    },
  } as never);

  it('requires an admin session', () => {
    expect(() => controller.current({})).toThrow(ForbiddenException);
    expect(() => controller.replace({}, {})).toThrow(ForbiddenException);
  });

  it('uses the authenticated admin and the admin guard', async () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, WalletConfigController)).toEqual([AdminAccessGuard]);
    await expect(controller.replace({ admin: { userId: 'admin-1' } }, { welcomeBonus: '9.00' })).resolves.toEqual({
      userId: 'admin-1',
    });
  });

  it('does not list wallet configuration history without an admin', () => {
    const listing = new WalletConfigController({
      async audits() {
        return { data: [{ id: 'secret' }] };
      },
    } as never);
    expect(() => listing.audits({}, {})).toThrow(ForbiddenException);
  });
});

describe('WalletBorrowingLimitAuditController', () => {
  it('requires an admin and does not mutate records', () => {
    const calls: string[] = [];
    const controller = new WalletBorrowingLimitAuditController({
      async borrowingLimitAudits() {
        calls.push('list');
        return { data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
      },
    } as never);
    expect(Reflect.getMetadata(GUARDS_METADATA, WalletBorrowingLimitAuditController)).toEqual([AdminAccessGuard]);
    expect(() => controller.list({}, {})).toThrow(ForbiddenException);
    expect(calls).toEqual([]);
  });
});
