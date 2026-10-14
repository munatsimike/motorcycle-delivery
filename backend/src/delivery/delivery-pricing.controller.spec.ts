import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { DeliveryPricingController } from './delivery-pricing.controller.js';

describe('DeliveryPricingController', () => {
  const controller = new DeliveryPricingController({
    async current() {
      return { pricingVersion: 1 };
    },
    async replace(admin: { userId: string }) {
      return { userId: admin.userId };
    },
  } as never);

  it('requires an admin session', () => {
    expect(() => controller.current({})).toThrow(ForbiddenException);
    expect(() => controller.replace({}, {})).toThrow(ForbiddenException);
  });

  it('uses the authenticated admin', async () => {
    await expect(controller.replace({ admin: { userId: 'admin-1' } }, { pricingVersion: 9 })).resolves.toEqual({ userId: 'admin-1' });
  });
});
