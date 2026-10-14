import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { UserRole } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { DeliveryPricingService } from './delivery-pricing.service.js';
import { DeliveryService } from './delivery.service.js';

const ADMIN = { userId: 'admin-1' };
const CUSTOMER = { userId: 'user-customer', role: UserRole.CUSTOMER as const, customerAccountId: 'account-customer' };
const RIDER = { userId: 'user-rider', role: UserRole.RIDER as const, customerAccountId: 'account-rider' };

describe('DeliveryService', () => {
  it('quotes and creates from the active tariff without assigning a rider', async () => {
    const ctx = context();
    await expect(ctx.deliveries.quote(pins())).rejects.toBeInstanceOf(ConflictException);
    await expect(ctx.deliveries.create(CUSTOMER, deliveryBody('1.00'))).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.deliveryRows).toHaveLength(0);

    await ctx.pricing.replace(ADMIN, tariff('2.00', '1.00', 0, 100_000));
    const quote = await ctx.deliveries.quote(pins());
    expect(quote).toEqual({
      distanceMeters: 0,
      pricingVersion: 1,
      currency: 'USD',
      suggestedPrice: '2.00',
    });
    expect(ctx.deliveryRows).toHaveLength(0);

    const individual = await ctx.deliveries.create(CUSTOMER, deliveryBody('0.50'));
    const business = await ctx.deliveries.create(
      { ...CUSTOMER, userId: 'user-business', customerAccountId: 'account-business' },
      deliveryBody('20.00'),
    );
    const rider = await ctx.deliveries.create(RIDER, deliveryBody('2.00'));

    expect(individual).toMatchObject({
      status: 'CREATED',
      currency: 'USD',
      payer: 'RECIPIENT',
      paymentMethod: 'CASH',
      pricingVersion: 1,
      suggestedPrice: '2.00',
      offeredPrice: '0.50',
      distanceMeters: 0,
    });
    expect(individual.pickup.contactPhone).toBe('+263771234567');
    expect(individual.dropoff.contactName).toBe('Rudo Ncube');
    expect(business.offeredPrice).toBe('20.00');
    expect(ctx.deliveryRows.map((row) => row.customerId)).toEqual(['account-customer', 'account-business', 'account-rider']);
    expect(ctx.deliveryRows.every((row) => row.suggestedPrice === '2.00')).toBe(true);
    expect(ctx.events).toEqual([
      expect.objectContaining({ newStatus: 'CREATED', previousStatus: null, actorId: 'user-customer', actorType: 'CUSTOMER' }),
      expect.objectContaining({ actorId: 'user-business', actorType: 'CUSTOMER' }),
      expect.objectContaining({ actorId: 'user-rider', actorType: 'CUSTOMER' }),
    ]);
    expect(ctx.assignments).toHaveLength(0);
    expect(ctx.users.map((user) => user.role)).toEqual([UserRole.CUSTOMER, UserRole.CUSTOMER, UserRole.RIDER]);
    expect(rider.offeredPrice).toBe('2.00');
  });

  it('keeps a delivery snapshot when the admin changes the tariff', async () => {
    const ctx = context();
    await ctx.pricing.replace(ADMIN, tariff('2.00', '1.00', 0, 100_000));
    const created = await ctx.deliveries.create(RIDER, deliveryBody('4.00'));
    await ctx.pricing.replace(ADMIN, tariff('9.00', '2.00', 0, 100_000));

    expect(ctx.deliveryRows[0]).toMatchObject({
      id: created.id,
      price: '4.00',
      suggestedPrice: '2.00',
      distanceMeters: 0,
      currency: 'USD',
      pricingVersion: 1,
    });
    await expect(ctx.deliveries.quote(pins())).resolves.toMatchObject({
      pricingVersion: 2,
      suggestedPrice: '9.00',
    });
  });

  it('rejects a trip outside the configured range and an invalid offer', async () => {
    const ctx = context();
    await ctx.pricing.replace(ADMIN, tariff('2.00', '1.00', 100, 1_000));
    await expect(ctx.deliveries.create(CUSTOMER, deliveryBody('1.00'))).rejects.toBeInstanceOf(BadRequestException);
    await ctx.pricing.replace(ADMIN, tariff('2.00', '1.00', 0, 100_000));
    const invalid = deliveryBody('1.500');
    await expect(ctx.deliveries.create(CUSTOMER, invalid)).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctx.deliveries.create(CUSTOMER, { ...deliveryBody('1.00'), pickup: { ...stop('0771234567', 'Tendai Moyo', '   ') } }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(ctx.deliveries.create(CUSTOMER, { ...deliveryBody('1.00'), pickup: { ...stop('123', 'Tendai Moyo', '12 Samora Machel Avenue') } }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.deliveryRows).toHaveLength(0);
  });
});

function tariff(baseFee: string, pricePerKilometre: string, minimumTripMetres: number, maximumTripMetres: number) {
  return { baseFee, pricePerKilometre, minimumTripMetres, maximumTripMetres };
}

function pins() {
  return {
    pickup: { latitude: -17.8292, longitude: 31.0522 },
    dropoff: { latitude: -17.8292, longitude: 31.0522 },
  };
}

function deliveryBody(offeredPrice: string) {
  return {
    customerId: 'other-account',
    suggestedPrice: '0.01',
    role: 'ADMIN',
    userId: 'other-user',
    status: 'DELIVERED',
    currency: 'USD',
    payer: 'RECIPIENT',
    paymentMethod: 'CASH',
    offeredPrice,
    pickup: stop('0771234567', 'Tendai Moyo', '12 Samora Machel Avenue'),
    dropoff: stop('0777654321', 'Rudo Ncube', '4 Jason Moyo Avenue'),
    parcel: { description: 'Documents', size: 'SMALL', instructions: 'Handle gently' },
  };
}

function stop(contactPhone: string, contactName: string, address: string) {
  return {
    latitude: -17.8292,
    longitude: 31.0522,
    address,
    landmark: 'Near the market',
    instructions: 'Call on arrival',
    contactName,
    contactPhone,
  };
}

function context() {
  const configs: Array<Record<string, unknown> & { id: string; isActive: boolean }> = [];
  const deliveryRows: Array<Record<string, unknown> & { id: string; customerId: string }> = [];
  const events: Array<Record<string, unknown>> = [];
  const assignments: unknown[] = [];
  const users = [
    { id: 'user-customer', role: UserRole.CUSTOMER },
    { id: 'user-business', role: UserRole.CUSTOMER },
    { id: 'user-rider', role: UserRole.RIDER },
  ];
  let nextId = 1;
  const db = {
    user: {
      async update() {
        throw new Error('user role changed');
      },
    },
    deliveryPricingConfig: {
      async findFirst({ where }: { where: { isActive: boolean } }) {
        return configs.find((row) => row.isActive === where.isActive) ?? null;
      },
      async update({ where, data }: { where: { id: string }; data: { isActive?: boolean; baseFee?: string } }) {
        if ('baseFee' in data) throw new Error('historical tariff fees were edited');
        const row = configs.find((item) => item.id === where.id);
        if (!row) throw new Error('missing tariff');
        Object.assign(row, data);
        return row;
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const row = { id: `config-${nextId}`, isActive: true, ...data };
        nextId += 1;
        configs.push(row);
        return row;
      },
    },
    delivery: {
      async create({ data }: { data: Record<string, unknown> }) {
        const row = { id: `delivery-${deliveryRows.length + 1}`, ...data };
        deliveryRows.push(row as { id: string; customerId: string });
        return row;
      },
      async update() {
        throw new Error('delivery changed');
      },
    },
    deliveryStatusEvent: {
      async create({ data }: { data: Record<string, unknown> }) {
        events.push(data);
        return data;
      },
    },
    deliveryAssignment: {
      async create() {
        assignments.push({});
        throw new Error('assignment created');
      },
    },
    async $queryRaw() {
      return [];
    },
    async $transaction<T>(callback: (tx: typeof db) => Promise<T>) {
      return callback(db);
    },
  };
  const prisma = db as unknown as PrismaService;
  return {
    pricing: new DeliveryPricingService(prisma),
    deliveries: new DeliveryService(prisma),
    configs,
    deliveryRows,
    events,
    assignments,
    users,
  };
}
