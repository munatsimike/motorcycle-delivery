import { BadRequestException, ConflictException } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { DeliveryStatus, PricingModel, PricingWindowKind, ServiceClass, UserRole } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { RoadDistance } from './geoapify.js';
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

  it('keeps the existing quote and delivery when Express and Flexible tariffs are also active', async () => {
    const ctx = context();
    await ctx.pricing.replace(ADMIN, tariff('2.00', '1.00', 0, 100_000));
    ctx.configs.unshift(
      classTariff('express', 'EXPRESS', '9.00'),
      classTariff('flexible', 'FLEXIBLE', '1.00'),
    );

    const quote = await ctx.deliveries.quote(pins());
    expect(quote).toEqual({
      distanceMeters: 0,
      pricingVersion: 1,
      currency: 'USD',
      suggestedPrice: '2.00',
    });
    const created = await ctx.deliveries.create(CUSTOMER, deliveryBody('1.00'));
    expect(created).toMatchObject({
      status: 'CREATED',
      currency: 'USD',
      payer: 'RECIPIENT',
      paymentMethod: 'CASH',
      pricingVersion: 1,
      suggestedPrice: '2.00',
      offeredPrice: '1.00',
      distanceMeters: 0,
    });
    expect(ctx.configs.filter((row) => row.serviceClass === 'EXPRESS' || row.serviceClass === 'FLEXIBLE')
      .every((row) => row.isActive)).toBe(true);
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
    await expect(ctx.deliveries.create(CUSTOMER, deliveryBody('1000.01'))).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctx.deliveries.create(CUSTOMER, deliveryBody('0.00'))).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctx.deliveries.create(CUSTOMER, deliveryBody('-1.00'))).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctx.deliveries.create(CUSTOMER, deliveryBody('NaN'))).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctx.deliveries.create(CUSTOMER, deliveryBody('Infinity'))).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctx.deliveries.create(CUSTOMER, { ...deliveryBody('1.00'), pickup: { ...stop('0771234567', 'Tendai Moyo', '   ') } }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(ctx.deliveries.create(CUSTOMER, { ...deliveryBody('1.00'), pickup: { ...stop('123', 'Tendai Moyo', '12 Samora Machel Avenue') } }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.deliveryRows).toHaveLength(0);
  });

  it('stores the customer offer at the limit and keeps the server suggestion', async () => {
    const ctx = context();
    await ctx.pricing.replace(ADMIN, tariff('2.00', '1.00', 0, 100_000));
    const created = await ctx.deliveries.create(CUSTOMER, deliveryBody('1000.00'));
    expect(created).toMatchObject({ offeredPrice: '1000.00', suggestedPrice: '2.00' });
    expect(ctx.deliveryRows[0]).toMatchObject({ price: '1000.00', suggestedPrice: '2.00' });
  });
});

function tariff(baseFee: string, pricePerKilometre: string, minimumTripMetres: number, maximumTripMetres: number) {
  return { baseFee, pricePerKilometre, minimumTripMetres, maximumTripMetres };
}

function matchesV1Pricing(
  row: { isActive: boolean; serviceClass?: string | null },
  where: { isActive?: boolean; serviceClass?: string | null },
) {
  if (where.isActive !== undefined && row.isActive !== where.isActive) return false;
  if (Object.prototype.hasOwnProperty.call(where, 'serviceClass') && (row.serviceClass ?? null) !== where.serviceClass) {
    return false;
  }
  return true;
}

function published(
  id: string,
  serviceClass: ServiceClass,
  pricingModel: PricingModel,
  baseFee: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    isActive: true,
    serviceClass,
    pricingModel,
    pricingVersion: serviceClass === ServiceClass.EXPRESS ? 9 : 8,
    baseFee,
    pricePerKilometre: '4.00',
    minimumTripMetres: 0,
    maximumTripMetres: 100_000,
    tiers: [] as Array<Record<string, unknown>>,
    windows: [] as Array<Record<string, unknown>>,
    ...overrides,
  };
}

function windowRow(id: string, kind: PricingWindowKind, basisPoints: number, enabled: boolean) {
  return {
    id,
    kind,
    enabled,
    daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    startsAt: '00:00',
    endsAt: '23:59',
    adjustmentBasisPoints: basisPoints,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function classTariff(id: string, serviceClass: 'EXPRESS' | 'FLEXIBLE', baseFee: string) {
  return {
    id,
    isActive: true,
    serviceClass,
    pricingVersion: serviceClass === 'EXPRESS' ? 9 : 8,
    baseFee,
    pricePerKilometre: '4.00',
    minimumTripMetres: 0,
    maximumTripMetres: 100_000,
  };
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
    placeId: 'ChIJstreet0001',
    coordinateSource: 'GOOGLE_PLACES',
  };
}

function context(options?: { metres?: number; now?: Date }) {
  const configs: Array<Record<string, unknown> & { id: string; isActive: boolean; serviceClass?: string | null }> = [];
  const audits: unknown[] = [];
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
      async findFirst(args?: { where?: { isActive?: boolean; serviceClass?: string | null }; orderBy?: { pricingVersion?: 'asc' | 'desc' } }) {
        const where = args?.where;
        let rows = configs.filter((row) => !where || matchesV1Pricing(row, where));
        if (args?.orderBy?.pricingVersion === 'desc') {
          rows = [...rows].sort((left, right) => Number(right.pricingVersion) - Number(left.pricingVersion));
        }
        return rows[0] ?? null;
      },
      async update({ where, data }: { where: { id: string }; data: { isActive?: boolean; baseFee?: string } }) {
        if ('baseFee' in data) throw new Error('historical tariff fees were edited');
        const row = configs.find((item) => item.id === where.id);
        if (!row) throw new Error('missing tariff');
        Object.assign(row, data);
        return row;
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const row = { id: `config-${nextId}`, isActive: true, serviceClass: null, ...data };
        nextId += 1;
        configs.push(row);
        return row;
      },
    },
    pricingConfigAudit: {
      async create({ data }: { data: Record<string, unknown> }) {
        audits.push(data);
        return { id: 'audit', createdAt: new Date(), ...data };
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
    bid: {
      async create() {
        throw new Error('bid written');
      },
    },
    walletFeeReservation: {
      async create() {
        throw new Error('reservation written');
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
  const roads: RoadDistance = {
    async metres() {
      return options?.metres ?? 0;
    },
  };
  return {
    pricing: new DeliveryPricingService(prisma),
    deliveries: new DeliveryService(prisma, roads, options?.now ? () => options.now as Date : undefined),
    configs,
    audits,
    deliveryRows,
    events,
    assignments,
    users,
  };
}

describe('flagged service-class quotes', () => {
  const previousFlag = process.env.V2_MARKETPLACE_ENABLED;
  afterEach(() => {
    if (previousFlag === undefined) {
      delete process.env.V2_MARKETPLACE_ENABLED;
    } else {
      process.env.V2_MARKETPLACE_ENABLED = previousFlag;
    }
  });

  it('keeps the V1 quote when the flag is absent or not exactly true', async () => {
    const ctx = context();
    await ctx.pricing.replace(ADMIN, tariff('2.00', '1.00', 0, 100_000));
    ctx.configs.unshift(classTariff('express', 'EXPRESS', '9.00'), classTariff('flexible', 'FLEXIBLE', '1.00'));
    const body = { ...pins(), serviceClass: 'EXPRESS', suggestedPrice: '0.01', pricingVersion: 99, basisPoints: 5_000 };

    delete process.env.V2_MARKETPLACE_ENABLED;
    await expect(ctx.deliveries.quote(body)).resolves.toEqual({
      distanceMeters: 0,
      pricingVersion: 1,
      currency: 'USD',
      suggestedPrice: '2.00',
    });

    process.env.V2_MARKETPLACE_ENABLED = 'false';
    await expect(ctx.deliveries.quote(body)).resolves.toEqual({
      distanceMeters: 0,
      pricingVersion: 1,
      currency: 'USD',
      suggestedPrice: '2.00',
    });
    const created = await ctx.deliveries.create(CUSTOMER, {
      ...deliveryBody('4.00'),
      serviceClass: 'FLEXIBLE',
      suggestedPrice: '0.01',
      pricingModel: 'FIXED',
      basisPoints: 5_000,
    });
    expect(created).toMatchObject({
      status: 'CREATED',
      payer: 'RECIPIENT',
      paymentMethod: 'CASH',
      pricingVersion: 1,
      suggestedPrice: '2.00',
      offeredPrice: '4.00',
    });
    expect(ctx.deliveryRows[0]).not.toHaveProperty('serviceClass');
    expect(ctx.events).toHaveLength(1);
    expect(ctx.assignments).toHaveLength(0);
    expect(ctx.audits).toHaveLength(1);
  });

  it('quotes the published class tariff and does not fall back when the flag is exactly true', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const now = new Date('2026-01-05T10:00:00.000Z');
    const ctx = context({ metres: 1_500, now });
    await ctx.pricing.replace(ADMIN, tariff('2.00', '1.00', 0, 100_000));
    ctx.configs.unshift(
      published('express', ServiceClass.EXPRESS, PricingModel.FIXED, '9.00'),
      published('flexible-old', ServiceClass.FLEXIBLE, PricingModel.FIXED, '1.00', { isActive: false, pricingVersion: 4 }),
      published('flexible', ServiceClass.FLEXIBLE, PricingModel.DISTANCE_TIERS, '1.00', {
        pricingVersion: 8,
        maximumTripMetres: 5_000,
        tiers: [
          { position: 1, upToMetres: 1_000, amount: '10.00' },
          { position: 2, upToMetres: 5_000, amount: '20.00' },
        ],
        windows: [
          windowRow('night', PricingWindowKind.NIGHT, 5_000, false),
          windowRow('peak', PricingWindowKind.PEAK, 1_000, true),
        ],
      }),
    );

    await expect(ctx.deliveries.quote(pins())).rejects.toThrow('Choose Express or Flexible');
    await expect(ctx.deliveries.quote({ ...pins(), serviceClass: 'RIDER' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctx.deliveries.quote({ ...pins(), serviceClass: 'FLEXIBLE' })).resolves.toEqual({
      distanceMeters: 1_500,
      pricingVersion: 8,
      pricingModel: 'DISTANCE_TIERS',
      serviceClass: 'FLEXIBLE',
      pricingWindow: { id: 'peak', kind: 'PEAK' },
      basisPoints: 1_000,
      currency: 'USD',
      suggestedPrice: '22.00',
    });

    const express = await ctx.deliveries.quote({ ...pins(), serviceClass: 'EXPRESS' });
    expect(express).toMatchObject({
      pricingVersion: 9,
      pricingModel: 'FIXED',
      serviceClass: 'EXPRESS',
      pricingWindow: null,
      basisPoints: 0,
      suggestedPrice: '9.00',
      distanceMeters: 1_500,
    });
    ctx.configs.find((row) => row.id === 'express')!.baseFee = '50.00';
    expect(express.suggestedPrice).toBe('9.00');

    ctx.configs.splice(ctx.configs.findIndex((row) => row.id === 'flexible'), 1);
    await expect(ctx.deliveries.quote({ ...pins(), serviceClass: 'FLEXIBLE' })).rejects.toThrow('Flexible pricing is not available');
    await expect(ctx.deliveries.quote({ ...pins(), serviceClass: 'EXPRESS' })).resolves.toMatchObject({ suggestedPrice: '50.00' });
    expect(ctx.deliveryRows).toHaveLength(0);
    expect(ctx.events).toHaveLength(0);
    expect(ctx.assignments).toHaveLength(0);
    expect(ctx.audits).toHaveLength(1);
  });

  it('quotes every pricing model through the flagged path', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = context({ metres: 1_500, now: new Date('2026-01-05T10:00:00.000Z') });
    ctx.configs.push(
      published('fixed', ServiceClass.EXPRESS, PricingModel.FIXED, '3.50', { pricePerKilometre: '9.00' }),
      published('per-km', ServiceClass.FLEXIBLE, PricingModel.PER_KILOMETRE, '9.00', { pricePerKilometre: '1.00', pricingVersion: 3 }),
    );
    await expect(ctx.deliveries.quote({ ...pins(), serviceClass: 'EXPRESS' })).resolves.toMatchObject({
      pricingModel: 'FIXED',
      suggestedPrice: '3.50',
      distanceMeters: 1_500,
    });
    await expect(ctx.deliveries.quote({ ...pins(), serviceClass: 'FLEXIBLE' })).resolves.toMatchObject({
      pricingModel: 'PER_KILOMETRE',
      suggestedPrice: '1.50',
    });

    ctx.configs.splice(0, ctx.configs.length,
      published('base', ServiceClass.EXPRESS, PricingModel.BASE_PLUS_PER_KILOMETRE, '2.00', { pricePerKilometre: '1.00' }),
    );
    await expect(ctx.deliveries.quote({ ...pins(), serviceClass: 'EXPRESS' })).resolves.toMatchObject({
      pricingModel: 'BASE_PLUS_PER_KILOMETRE',
      suggestedPrice: '3.50',
      basisPoints: 0,
      pricingWindow: null,
    });
    await expect(ctx.deliveries.quote({ ...pins(), serviceClass: 'FLEXIBLE' })).rejects.toThrow('Flexible pricing is not available');
    expect(ctx.deliveryRows).toHaveLength(0);
    expect(ctx.audits).toHaveLength(0);
  });

  it('opens a V2 request from the class tariff when the flag is on and ignores the client snapshot', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = context({ now: new Date('2026-10-24T08:00:00.000Z') });
    await ctx.pricing.replace(ADMIN, tariff('2.00', '1.00', 0, 100_000));
    ctx.configs.unshift(published('express', ServiceClass.EXPRESS, PricingModel.FIXED, '9.00'));
    const body = {
      ...deliveryBody('4.00'),
      serviceClass: 'EXPRESS',
      deliverBy: '2026-10-24T18:00:00.000Z',
      pricingModel: 'FIXED',
      pricingVersion: 99,
      basisPoints: 5_000,
      pricingWindow: { id: 'client', kind: 'NIGHT' },
      suggestedPrice: '0.01',
      distanceMeters: 1_500,
    };

    await expect(ctx.deliveries.create(CUSTOMER, { ...body, deliverBy: undefined })).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.deliveryRows).toHaveLength(0);

    const created = await ctx.deliveries.create(CUSTOMER, { ...body, payer: undefined, paymentMethod: undefined, offeredPrice: undefined });
    expect(created).toMatchObject({
      status: 'CREATED',
      payer: null,
      paymentMethod: null,
      pricingVersion: 9,
      pricingModel: 'FIXED',
      basisPoints: 0,
      serviceClass: 'EXPRESS',
      deliverBy: '2026-10-24T18:00:00.000Z',
      suggestedPrice: '9.00',
      offeredPrice: null,
      searchGeneration: 0,
    });
    expect(ctx.deliveryRows[0]).toMatchObject({
      price: null,
      suggestedPrice: '9.00',
      pricingVersion: 9,
      serviceClass: 'EXPRESS',
      searchGeneration: 0,
    });
    expect(ctx.assignments).toHaveLength(0);
    expect(ctx.audits).toHaveLength(1);
  });
});

describe('DeliveryService list', () => {
  const older = new Date('2026-10-01T00:00:00.000Z');
  const sameTime = new Date('2026-10-16T12:00:00.000Z');
  const rows = [
    row('a-old', 'account-a', 'DELIVERED', older, 'Old pickup', 'Old drop-off'),
    row('a-1', 'account-a', 'CREATED', sameTime, 'Low pickup', 'Low drop-off'),
    row('a-2', 'account-a', 'SEARCHING', sameTime, 'High pickup', 'High drop-off'),
    row('b-only', 'account-b', 'CREATED', sameTime, 'Other pickup', 'Other drop-off', '+263771111111'),
  ];

  it('returns only the authenticated customer deliveries in a stable order', async () => {
    const service = new DeliveryService(listPrisma(rows) as never);
    const page = await service.list(customer('account-a'), { customerId: 'account-b', page: '1', limit: '2' });
    expect(page.data.map((delivery) => delivery.id)).toEqual(['a-2', 'a-1']);
    expect(page.data[0]).toEqual({
      id: 'a-2',
      reference: 'a-2',
      status: 'SEARCHING',
      createdAt: sameTime,
      serviceClass: null,
      deliverBy: null,
      currency: null,
      suggestedPrice: null,
      offeredPrice: null,
      pickup: { address: 'High pickup' },
      dropoff: { address: 'High drop-off' },
    });
    expect(page.data[0]).not.toHaveProperty('pickupContactPhone');
    expect(JSON.stringify(page)).not.toContain('account-b');
    expect(page.pagination).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });

    const next = await service.list(customer('account-a'), { page: '2', limit: '2' });
    expect(next.data.map((delivery) => delivery.id)).toEqual(['a-old']);
    expect(next.data[0]?.status).toBe('DELIVERED');
  });

  it('returns an empty page when the customer has no deliveries', async () => {
    const service = new DeliveryService(listPrisma(rows) as never);
    await expect(service.list(customer('account-c'), {})).resolves.toEqual({
      data: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
  });

  it('filters by backend statuses and rejects an invalid page', async () => {
    const service = new DeliveryService(listPrisma(rows) as never);
    const active = await service.list(customer('account-a'), { status: ['CREATED', 'SEARCHING'] });
    expect(active.data.map((delivery) => delivery.status)).toEqual(['SEARCHING', 'CREATED']);
    await expect(service.list(customer('account-a'), { page: '0' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.list(customer('account-a'), { status: 'EN_ROUTE' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns the service class, deadline, and prices for a V2 request', async () => {
    const deadline = new Date('2026-10-24T18:00:00.000Z');
    const service = new DeliveryService(listPrisma([{
      ...row('v2', 'account-a', 'CREATED', sameTime, 'Pickup road', 'Drop-off road'),
      serviceClass: 'FLEXIBLE',
      deliverBy: deadline,
      currency: 'USD',
      suggestedPrice: '8.00',
      price: '9.50',
    }]) as never);
    const page = await service.list(customer('account-a'), {});
    expect(page.data[0]).toMatchObject({
      status: 'CREATED',
      serviceClass: 'FLEXIBLE',
      deliverBy: '2026-10-24T18:00:00.000Z',
      currency: 'USD',
      suggestedPrice: '8.00',
      offeredPrice: '9.50',
    });
    expect(JSON.stringify(page)).not.toContain('+263');
  });
});

function customer(customerAccountId: string) {
  return { userId: 'user-1', role: UserRole.CUSTOMER as const, customerAccountId };
}

function row(
  id: string,
  customerId: string,
  status: DeliveryStatus,
  createdAt: Date,
  pickupAddress: string,
  dropoffAddress: string,
  pickupContactPhone = '+263771234567',
) {
  return { id, customerId, status, createdAt, pickupAddress, dropoffAddress, pickupContactPhone };
}

function listPrisma(rows: ReturnType<typeof row>[]) {
  return {
    delivery: {
      async count({ where }: { where: ListWhere }) {
        return rows.filter((item) => matches(item, where)).length;
      },
      async findMany({ where, skip, take, select }: { where: ListWhere; skip: number; take: number; select: Record<string, boolean> }) {
        const sorted = rows.filter((item) => matches(item, where)).sort((left, right) => {
          const time = right.createdAt.getTime() - left.createdAt.getTime();
          if (time !== 0) {
            return time;
          }
          return left.id < right.id ? 1 : left.id > right.id ? -1 : 0;
        });
        return sorted.slice(skip, skip + take).map((item) => {
          const selected: Record<string, unknown> = {};
          for (const key of Object.keys(select)) {
            selected[key] = item[key as keyof typeof item];
          }
          return selected;
        });
      },
    },
    async $transaction<T>(operations: Promise<T>[]) {
      return Promise.all(operations);
    },
  };
}

type ListWhere = { customerId: string; status?: { in: DeliveryStatus[] } };

function matches(item: ReturnType<typeof row>, where: ListWhere): boolean {
  if (item.customerId !== where.customerId) {
    return false;
  }
  if (where.status && !where.status.in.includes(item.status)) {
    return false;
  }
  return true;
}
