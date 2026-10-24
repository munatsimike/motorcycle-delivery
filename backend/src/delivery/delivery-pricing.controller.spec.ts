import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';
import { UserRole } from '../generated/prisma/client.js';
import { AdminAccessGuard } from '../auth/admin-access.guard.js';
import { AdminAccessService } from '../auth/admin-access.service.js';
import { DeliveryPricingController } from './delivery-pricing.controller.js';

describe('DeliveryPricingController', () => {
  const controller = new DeliveryPricingController({
    async current() {
      return { pricingVersion: 1 };
    },
    async replace(admin: { userId: string }) {
      return { userId: admin.userId };
    },
  } as never, {
    async currentClasses() {
      return { express: null, flexible: null };
    },
    async currentClass() {
      return { pricingVersion: 1 };
    },
    async publish(admin: { userId: string }) {
      return { userId: admin.userId };
    },
    async setWindowEnabled(admin: { userId: string }) {
      return { userId: admin.userId };
    },
    async audits() {
      return { data: [] };
    },
  } as never);

  it('requires an admin session', () => {
    expect(() => controller.current({})).toThrow(ForbiddenException);
    expect(() => controller.replace({}, {})).toThrow(ForbiddenException);
    expect(() => controller.currentClasses({})).toThrow(ForbiddenException);
    expect(() => controller.classTariff({}, 'EXPRESS')).toThrow(ForbiddenException);
    expect(() => controller.publish({}, 'EXPRESS', {})).toThrow(ForbiddenException);
    expect(() => controller.setWindowEnabled({}, 'EXPRESS', 'window-1', {})).toThrow(ForbiddenException);
    expect(() => controller.auditHistory({}, {})).toThrow(ForbiddenException);
  });

  it('uses the authenticated admin and the admin guard', async () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, DeliveryPricingController)).toEqual([AdminAccessGuard]);
    await expect(controller.replace({ admin: { userId: 'admin-1' } }, { pricingVersion: 9 })).resolves.toEqual({ userId: 'admin-1' });
    await expect(controller.publish({ admin: { userId: 'admin-1' } }, 'EXPRESS', {})).resolves.toEqual({ userId: 'admin-1' });
  });

  it('rejects customer and rider sessions before pricing is read', async () => {
    for (const role of [UserRole.CUSTOMER, UserRole.RIDER]) {
      const access = new AdminAccessService({
        refreshSession: { async findUnique() { throw new Error('session read'); } },
        user: { async findUnique() { throw new Error('user read'); } },
      } as never, { verify: () => ({ role, sid: 'session-1', sub: 'user-1' }) } as never);
      await expect(access.authenticate('Bearer token')).rejects.toThrow('Admin access is required');
    }
  });
});
