import { ForbiddenException } from '@nestjs/common';
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
    async adjustOffer() {
      return { customerOffer: '1.00' };
    },
  } as never, {} as never);

  it('requires an authenticated customer account', async () => {
    expect(() => controller.quote({}, {})).toThrow(ForbiddenException);
    await expect(controller.create({}, {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(() => controller.list({}, {})).toThrow(ForbiddenException);
    expect(() => controller.getById({}, 'delivery-1')).toThrow(ForbiddenException);
    expect(() => controller.search({}, 'delivery-1')).toThrow(ForbiddenException);
    expect(() => controller.adjustOffer({}, 'delivery-1', {})).toThrow(ForbiddenException);
    expect(() => controller.cancel({}, 'delivery-1')).toThrow(ForbiddenException);
  });

  it('returns the created booking without starting a search', async () => {
    const created = { id: 'delivery-v2', status: 'CREATED', searchGeneration: 0 };
    let searched = false;
    const flagged = new DeliveryController({
      async create() {
        return created;
      },
    } as never, {
      async search() {
        searched = true;
        return { deliveryId: created.id, status: 'SEARCHING', searchGeneration: 1 };
      },
    } as never, {} as never);
    delete process.env.V2_MARKETPLACE_ENABLED;
    await expect(flagged.create({ customer: CUSTOMER }, {})).resolves.toEqual(created);
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    await expect(flagged.create({ customer: CUSTOMER }, {})).resolves.toEqual(created);
    delete process.env.V2_MARKETPLACE_ENABLED;
    expect(searched).toBe(false);

    const response = await controller.create({ customer: CUSTOMER }, { customerId: 'other-account' });
    expect(seen.accountId).toBe('account-1');
    expect(seen.deliveryId).toBeUndefined();
    expect(response).toEqual({ id: 'delivery-1', status: 'CREATED', customerAccountId: 'account-1' });
  });

  it('draws the cached route from pickup and dropoff', async () => {
    const drawn: number[] = [];
    const mapped = new DeliveryController({
      async getById() {
        return {
          pickup: { latitude: '-17.1000000', longitude: '31.1000000' },
          dropoff: { latitude: '-17.2000000', longitude: '31.2000000' },
          riderLocation: { latitude: '-17.8010000', longitude: '31.1090000' },
        };
      },
    } as never, {} as never, {
      async deliveryMap(
        pickupLatitude: number,
        pickupLongitude: number,
        dropoffLatitude: number,
        dropoffLongitude: number,
      ) {
        drawn.push(pickupLatitude, pickupLongitude, dropoffLatitude, dropoffLongitude);
        return new Uint8Array([1, 2, 3]);
      },
    } as never);

    const file = await mapped.map({ customer: CUSTOMER }, 'delivery-1');
    expect(drawn).toEqual([-17.1, 31.1, -17.2, 31.2]);
    expect(JSON.stringify(drawn)).not.toContain('17.801');
    expect(file.options.type).toBe('image/png');
  });

  it('lists with the session account and ignores a customer id in the query', async () => {
    const response = await controller.list({
      customer: { userId: 'user-1', role: UserRole.CUSTOMER, customerAccountId: 'account-1' },
    }, { customerId: 'account-2' });
    expect(response).toEqual({ customerAccountId: 'account-1', requestedCustomerId: 'account-2' });
  });
});
