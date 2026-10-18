import { ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { UserRole } from '../generated/prisma/client.js';
import { DeliveryController } from './delivery.controller.js';

const CUSTOMER = { userId: 'user-1', role: UserRole.CUSTOMER, customerAccountId: 'account-1' };

describe('DeliveryController', () => {
  const seen: { accountId?: string; deliveryId?: string } = {};
  const controller = new DeliveryController({
    async quote() {
      return { suggestedPrice: '2.00' };
    },
    async create(customer: { customerAccountId: string }) {
      seen.accountId = customer.customerAccountId;
      return { id: 'delivery-1', status: 'CREATED', customerAccountId: customer.customerAccountId };
    },
    async list(customer: { customerAccountId: string }, query: { customerId?: string }) {
      return { customerAccountId: customer.customerAccountId, requestedCustomerId: query.customerId ?? null };
    },
    async getById() {
      return { id: 'delivery-1', status: 'SEARCHING' };
    },
  } as never, {
    async search(customer: { customerAccountId: string }, deliveryId: string) {
      seen.deliveryId = deliveryId;
      if (customer.customerAccountId !== 'account-1') {
        throw new Error('search ignored the session account');
      }
      return { deliveryId, status: 'SEARCHING', searchGeneration: 1 };
    },
    async cancel() {
      return { status: 'CANCELLED' };
    },
  } as never, {} as never);

  it('requires an authenticated customer account', async () => {
    expect(() => controller.quote({}, {})).toThrow(ForbiddenException);
    await expect(controller.create({}, {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(() => controller.list({}, {})).toThrow(ForbiddenException);
    expect(() => controller.getById({}, 'delivery-1')).toThrow(ForbiddenException);
    expect(() => controller.search({}, 'delivery-1')).toThrow(ForbiddenException);
    expect(() => controller.cancel({}, 'delivery-1')).toThrow(ForbiddenException);
  });

  it('searches only after the booking is committed and returns the persisted status', async () => {
    const response = await controller.create({ customer: CUSTOMER }, { customerId: 'other-account' });
    expect(seen.accountId).toBe('account-1');
    expect(seen.deliveryId).toBe('delivery-1');
    expect(response).toEqual({ id: 'delivery-1', status: 'SEARCHING' });
  });

  it('keeps the committed booking when automatic search fails', async () => {
    const created = { id: 'delivery-9', status: 'CREATED', searchGeneration: 0 };
    let reloaded = false;
    const failing = new DeliveryController({
      async create() {
        return created;
      },
      async getById() {
        reloaded = true;
        return { id: 'delivery-9', status: 'SEARCHING' };
      },
    } as never, {
      async search() {
        throw new ConflictException('A search is already running');
      },
    } as never, {} as never);

    const response = await failing.create({ customer: CUSTOMER }, {});
    expect(response).toEqual(created);
    expect(reloaded).toBe(false);
  });

  it('returns the search result when the delivery cannot be reloaded', async () => {
    const created = { id: 'delivery-4', status: 'CREATED', searchGeneration: 0, autoRetryCount: 0, nextRetryAt: null };
    const reloading = new DeliveryController({
      async create() {
        return created;
      },
      async getById() {
        throw new Error('database unavailable');
      },
    } as never, {
      async search() {
        return { deliveryId: 'delivery-4', status: 'SEARCHING', searchGeneration: 1 };
      },
    } as never, {} as never);

    await expect(reloading.create({ customer: CUSTOMER }, {})).resolves.toEqual({
      id: 'delivery-4',
      status: 'SEARCHING',
      searchGeneration: 1,
      autoRetryCount: 0,
      nextRetryAt: null,
    });
  });

  it('lists with the session account and ignores a customer id in the query', async () => {
    const response = await controller.list({
      customer: { userId: 'user-1', role: UserRole.CUSTOMER, customerAccountId: 'account-1' },
    }, { customerId: 'account-2' });
    expect(response).toEqual({ customerAccountId: 'account-1', requestedCustomerId: 'account-2' });
  });
});
