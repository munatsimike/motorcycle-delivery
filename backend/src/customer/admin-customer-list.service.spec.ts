import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AdminCustomerListService } from './admin-customer-list.service.js';

const CUSTOMER_ID = '018f5b2a-6c3d-7e4f-8a9b-0c1d2e3f4a5b';

const row = {
  id: CUSTOMER_ID,
  kind: 'INDIVIDUAL',
  name: 'Ada Stores',
  contactName: 'Ada',
  address: 'Harare',
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-02T00:00:00.000Z'),
  user: { fullName: 'Ada Moyo', phone: '+263771000001', accountStatus: 'ACTIVE' },
};

function service(options?: { missing?: boolean; deliveries?: unknown[] }) {
  const calls: Array<{ model: string; action: string; args: unknown }> = [];
  const prisma = {
    customerAccount: {
      async count(args: unknown) {
        calls.push({ model: 'customer', action: 'count', args });
        return options?.missing ? 0 : 1;
      },
      async findMany(args: unknown) {
        calls.push({ model: 'customer', action: 'findMany', args });
        return options?.missing ? [] : [row];
      },
      async findUnique(args: unknown) {
        calls.push({ model: 'customer', action: 'findUnique', args });
        return options?.missing ? null : row;
      },
    },
    delivery: {
      async count(args: unknown) {
        calls.push({ model: 'delivery', action: 'count', args });
        return options?.deliveries?.length ?? 1;
      },
      async findMany(args: unknown) {
        calls.push({ model: 'delivery', action: 'findMany', args });
        return options?.deliveries ?? [{
          id: '018f5b2a-6c3d-7e4f-8a9b-0c1d2e3f4a5c',
          deliveryType: 'PARCEL',
          status: 'DELIVERED',
          pickupAddress: 'A',
          dropoffAddress: 'B',
          price: { toString: () => '4.00' },
          currency: 'USD',
          paymentMethod: 'CASH',
          assignments: [],
          createdAt: new Date('2026-10-03T00:00:00.000Z'),
          updatedAt: new Date('2026-10-03T01:00:00.000Z'),
        }];
      },
    },
  };
  return { service: new AdminCustomerListService(prisma as never), calls };
}

describe('AdminCustomerListService', () => {
  it('filters a page by name and phone without loading every customer', async () => {
    const { service: customers, calls } = service();
    const page = await customers.list({ q: 'Ada', page: '2', limit: '10' });
    expect(page.pagination).toEqual({ page: 2, limit: 10, total: 1, totalPages: 1 });
    expect(page.data[0]).toMatchObject({ name: 'Ada Stores', phone: '+263771000001' });
    const count = calls.find((call) => call.action === 'count');
    expect(count?.args).toMatchObject({
      where: {
        OR: expect.arrayContaining([
          { name: { contains: 'Ada', mode: 'insensitive' } },
          { user: { is: { phone: { contains: 'Ada' } } } },
        ]),
      },
    });
    expect(calls.find((call) => call.action === 'findMany')?.args).toMatchObject({ skip: 10, take: 10 });
  });

  it('also matches the digits of a formatted phone search', async () => {
    const { service: customers, calls } = service();
    await customers.list({ q: '+263 77' });
    expect(calls[0]?.args).toMatchObject({
      where: {
        OR: expect.arrayContaining([
          { user: { is: { phone: { contains: '26377' } } } },
        ]),
      },
    });
  });

  it('rejects an oversized search and an oversized page', async () => {
    const { service: customers } = service();
    await expect(customers.list({ q: 'a'.repeat(81) })).rejects.toBeInstanceOf(BadRequestException);
    await expect(customers.list({ limit: '101' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns one customer and a read-only delivery page', async () => {
    const { service: customers, calls } = service();
    const found = await customers.getById(CUSTOMER_ID);
    const profile = calls.find((call) => call.action === 'findUnique');
    calls.length = 0;
    const history = await customers.listDeliveries(CUSTOMER_ID, { page: '1', limit: '20' });
    expect(found.customerAccountId).toBe(CUSTOMER_ID);
    expect(profile?.args).toMatchObject({ where: { id: CUSTOMER_ID } });
    expect(history.data[0]).toMatchObject({ status: 'DELIVERED', price: '4.00' });
    expect(calls.find((call) => call.model === 'delivery' && call.action === 'findMany')?.args).toMatchObject({
      where: { customerId: CUSTOMER_ID },
    });
  });

  it('does not invent a delivery page for a missing customer', async () => {
    const { service: customers } = service({ missing: true });
    await expect(customers.getById(CUSTOMER_ID)).rejects.toBeInstanceOf(NotFoundException);
    await expect(customers.listDeliveries(CUSTOMER_ID, {})).rejects.toBeInstanceOf(NotFoundException);
  });
});
