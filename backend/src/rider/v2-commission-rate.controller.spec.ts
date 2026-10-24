import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';
import { UserRole } from '../generated/prisma/client.js';
import { AdminAccessGuard } from '../auth/admin-access.guard.js';
import { AdminAccessService } from '../auth/admin-access.service.js';
import { V2CommissionRateController } from './v2-commission-rate.controller.js';

describe('V2CommissionRateController', () => {
  const controller = new V2CommissionRateController({
    async current() {
      return { configured: false };
    },
    async publish(admin: { userId: string }) {
      return { userId: admin.userId };
    },
    async audits() {
      return { data: [] };
    },
  } as never);

  it('requires an admin session', () => {
    expect(() => controller.current({})).toThrow(ForbiddenException);
    expect(() => controller.publish({}, {})).toThrow(ForbiddenException);
    expect(() => controller.audits({}, {})).toThrow(ForbiddenException);
  });

  it('uses the authenticated admin and the admin guard', async () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, V2CommissionRateController)).toEqual([AdminAccessGuard]);
    await expect(controller.publish({ admin: { userId: 'admin-1' } }, { percentage: '10' })).resolves.toEqual({ userId: 'admin-1' });
  });

  it('rejects customer and rider sessions before the rate is read', async () => {
    for (const role of [UserRole.CUSTOMER, UserRole.RIDER]) {
      const access = new AdminAccessService({
        refreshSession: { async findUnique() { throw new Error('session read'); } },
        user: { async findUnique() { throw new Error('user read'); } },
      } as never, { verify: () => ({ role, sid: 'session-1', sub: 'user-1' }) } as never);
      await expect(access.authenticate('Bearer token')).rejects.toThrow('Admin access is required');
    }
  });
});
