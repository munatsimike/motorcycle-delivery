import { ExecutionContext, ForbiddenException, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountStatus, UserRole } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AccessTokenService } from '../auth/access-token.service.js';
import { CustomerAccessGuard } from '../auth/customer-access.guard.js';
import { CustomerAccessService } from '../auth/customer-access.service.js';
import { RiderAccessGuard } from '../auth/rider-access.guard.js';
import { RiderAccessService } from '../auth/rider-access.service.js';
import { DeliveryController } from './delivery.controller.js';
import { RiderDeliveryController } from './rider-delivery.controller.js';
import { RiderOfferController } from './rider-offer.controller.js';
import { RiderLocationController } from '../rider/rider-location.controller.js';

const SECRET = '0123456789abcdef0123456789abcdef';

describe('dispatch route guards', () => {
  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.JWT_ACCESS_SECRET;
  });

  it('keeps search and cancellation on the customer guard', () => {
    expect(Reflect.getMetadata(PATH_METADATA, DeliveryController)).toBe('customers/me/deliveries');
    expect(Reflect.getMetadata(GUARDS_METADATA, DeliveryController)).toEqual([CustomerAccessGuard]);
    expect(Reflect.getMetadata(METHOD_METADATA, DeliveryController.prototype.search)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PATH_METADATA, DeliveryController.prototype.search)).toBe(':deliveryId/search');
    expect(Reflect.getMetadata(PATH_METADATA, DeliveryController.prototype.cancel)).toBe(':deliveryId/cancellation');
  });

  it('keeps location, offers, acceptance, and release on the rider guard', () => {
    expect(Reflect.getMetadata(PATH_METADATA, RiderLocationController)).toBe('riders/me/location');
    expect(Reflect.getMetadata(GUARDS_METADATA, RiderLocationController)).toEqual([RiderAccessGuard]);
    expect(Reflect.getMetadata(METHOD_METADATA, RiderLocationController.prototype.update)).toBe(RequestMethod.PUT);
    expect(Reflect.getMetadata(PATH_METADATA, RiderOfferController)).toBe('riders/me/offers');
    expect(Reflect.getMetadata(GUARDS_METADATA, RiderOfferController)).toEqual([RiderAccessGuard]);
    expect(Reflect.getMetadata(METHOD_METADATA, RiderOfferController.prototype.list)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PATH_METADATA, RiderOfferController.prototype.accept)).toBe(':assignmentId/acceptance');
    expect(Reflect.getMetadata(PATH_METADATA, RiderOfferController.prototype.release)).toBe(':assignmentId/release');
    expect(Reflect.getMetadata(PATH_METADATA, RiderDeliveryController)).toBe('riders/me/deliveries');
    expect(Reflect.getMetadata(GUARDS_METADATA, RiderDeliveryController)).toEqual([RiderAccessGuard]);
    expect(Reflect.getMetadata(METHOD_METADATA, RiderDeliveryController.prototype.updateStatus)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PATH_METADATA, RiderDeliveryController.prototype.updateStatus)).toBe(':deliveryId/status');
  });

  it('rejects a rider token on customer search and a customer token on rider offers', async () => {
    const rider = riderAccess();
    const customer = customerAccess();
    const searches: string[] = [];
    const offers: string[] = [];
    const delivery = new DeliveryController({} as never, {
      async search(account: { customerAccountId: string }) {
        searches.push(account.customerAccountId);
        return { status: 'SEARCHING' };
      },
      async cancel() {
        return { status: 'CANCELLED' };
      },
    } as never, {} as never);
    const offerController = new RiderOfferController({
      async listOffers(actor: { riderProfileId: string }) {
        offers.push(actor.riderProfileId);
        return { offers: [] };
      },
      async accept() {
        return {};
      },
      async release() {
        return {};
      },
    } as never);
    const location = new RiderLocationController({
      async update(actor: { riderProfileId: string }) {
        offers.push(actor.riderProfileId);
        return { updatedAt: '2026-10-14T00:00:00.000Z' };
      },
    } as never);

    await expect(new CustomerAccessGuard(customer.service).canActivate(http({
      headers: { authorization: customer.token(UserRole.ADMIN) },
    }))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(new RiderAccessGuard(rider.service).canActivate(http({
      headers: { authorization: customer.token(UserRole.CUSTOMER) },
    }))).rejects.toBeInstanceOf(ForbiddenException);
    expect(() => delivery.search({}, 'delivery-1')).toThrow(ForbiddenException);
    expect(() => offerController.list({})).toThrow(ForbiddenException);
    expect(() => location.update({}, { latitude: 0, longitude: 0 })).toThrow(ForbiddenException);

    const customerRequest = { headers: { authorization: customer.token(UserRole.CUSTOMER) }, customer: undefined as unknown };
    await new CustomerAccessGuard(customer.service).canActivate(http(customerRequest));
    await delivery.search(customerRequest, 'delivery-1');
    const riderRequest = { headers: { authorization: rider.token(UserRole.RIDER) }, rider: undefined as unknown };
    await new RiderAccessGuard(rider.service).canActivate(http(riderRequest));
    await offerController.list(riderRequest);
    await location.update(riderRequest, { riderProfileId: 'other-profile', latitude: 0, longitude: 0 });
    const progress: string[] = [];
    const progressController = new RiderDeliveryController({
      async progress(actor: { riderProfileId: string }, deliveryId: string) {
        progress.push(`${actor.riderProfileId}:${deliveryId}`);
        return { deliveryId, status: 'ARRIVED_AT_PICKUP', availability: 'BUSY' };
      },
    } as never);
    expect(() => progressController.updateStatus({}, 'delivery-1', { status: 'ARRIVED_AT_PICKUP' })).toThrow(ForbiddenException);
    await progressController.updateStatus(riderRequest, 'delivery-1', {
      status: 'ARRIVED_AT_PICKUP',
      riderProfileId: 'other-profile',
    });
    expect(searches).toEqual(['account-1']);
    expect(offers).toEqual(['profile-1', 'profile-1']);
    expect(progress).toEqual(['profile-1:delivery-1']);
  });
});

function http(request: object): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext;
}

function session(now: Date) {
  return {
    id: 'session-1',
    userId: 'user-1',
    revokedAt: null,
    replacedBySessionId: null,
    expiresAt: new Date(now.getTime() + 60_000),
  };
}

function riderAccess() {
  const now = new Date();
  const current = session(now);
  const user = {
    id: 'user-1',
    role: UserRole.RIDER,
    accountStatus: AccountStatus.ACTIVE,
    phoneVerifiedAt: now,
    riderProfile: { id: 'profile-1', userId: 'user-1' },
    customerAccount: null,
  };
  const db = {
    refreshSession: { async findUnique({ where }: { where: { id: string } }) { return current.id === where.id ? current : null; } },
    user: { async findUnique({ where }: { where: { id: string } }) { return user.id === where.id ? user : null; } },
  };
  const tokens = new AccessTokenService();
  return {
    service: new RiderAccessService(db as unknown as PrismaService, tokens),
    token(role: UserRole) {
      return `Bearer ${tokens.sign({ sub: user.id, role, sid: current.id }, now).token}`;
    },
  };
}

function customerAccess() {
  const now = new Date();
  const current = session(now);
  const user = {
    id: 'user-1',
    role: UserRole.CUSTOMER,
    accountStatus: AccountStatus.ACTIVE,
    phoneVerifiedAt: now,
    riderProfile: null,
    customerAccount: { id: 'account-1', userId: 'user-1' },
  };
  const db = {
    refreshSession: { async findUnique({ where }: { where: { id: string } }) { return current.id === where.id ? current : null; } },
    user: { async findUnique({ where }: { where: { id: string } }) { return user.id === where.id ? { ...user, role: UserRole.CUSTOMER } : null; } },
  };
  const tokens = new AccessTokenService();
  return {
    service: new CustomerAccessService(db as unknown as PrismaService, tokens),
    token(role: UserRole) {
      return `Bearer ${tokens.sign({ sub: user.id, role, sid: current.id }, now).token}`;
    },
  };
}
