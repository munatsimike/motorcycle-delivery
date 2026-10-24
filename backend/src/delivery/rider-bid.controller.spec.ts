import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CustomerBidController } from './customer-bid.controller.js';
import { RiderBidController } from './rider-bid.controller.js';

describe('bid route authorization', () => {
  const riderRoutes = new RiderBidController({} as never);
  const customerRoutes = new CustomerBidController({} as never, {} as never);

  it('requires the signed-in rider and an idempotency key', () => {
    expect(() => riderRoutes.listRequests({})).toThrow(ForbiddenException);
    expect(() => riderRoutes.list({})).toThrow(ForbiddenException);
    expect(() => riderRoutes.submit({}, { deliveryId: 'x', amountCents: 100 })).toThrow(ForbiddenException);
    expect(() => riderRoutes.withdraw({}, 'bid-1')).toThrow(ForbiddenException);
    expect(() => riderRoutes.submit({
      rider: { userId: 'user-1', riderProfileId: 'profile-1' },
      headers: {},
    }, {})).toThrow(BadRequestException);
  });

  it('requires the signed-in customer and an idempotency key', () => {
    expect(() => customerRoutes.list({}, 'delivery-1')).toThrow(ForbiddenException);
    expect(() => customerRoutes.accept({}, 'delivery-1', 'bid-1')).toThrow(ForbiddenException);
    expect(() => customerRoutes.accept({
      customer: { userId: 'user-1', role: 'CUSTOMER' as never, customerAccountId: 'account-1' },
      headers: {},
    }, 'delivery-1', 'bid-1')).toThrow(BadRequestException);
  });
});
