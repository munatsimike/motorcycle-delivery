import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';
import { AdminAccessGuard } from '../auth/admin-access.guard.js';
import { WalletConfigController } from './wallet-config.controller.js';

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
});
