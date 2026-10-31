import { BadRequestException, NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { DeliveryStatus, PricingModel, PricingWindowKind, ServiceClass, UserRole } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { RoadDistance } from './geoapify.js';
import { DeliveryService } from './delivery.service.js';

const CUSTOMER = { userId: 'user-customer', role: UserRole.CUSTOMER, customerAccountId: 'account-customer' };
const RIDER = { userId: 'user-rider', role: UserRole.RIDER, customerAccountId: 'account-rider' };

describe('DeliveryService', () => {
  it('does not quote or create a V1 delivery when the marketplace flag is off', async () => {
    const ctx = context();
    await expect(ctx.deliveries.quote(pins())).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctx.deliveries.create(CUSTOMER, deliveryBody('1.00'))).rejects.toThrow('Bidding is not available');
    expect(ctx.deliveryRows).toHaveLength(0);

    seedLegacyTariff(ctx, tariff('2.00', '1.00', 0, 100_000));
    await expect(ctx.deliveries.quote(pins())).rejects.toThrow('Bidding is not available');
    await expect(ctx.deliveries.create(CUSTOMER, deliveryBody('0.50'))).rejects.toThrow('Bidding is not available');
    await expect(ctx.deliveries.create(RIDER, deliveryBody('2.00'))).rejects.toThrow('Bidding is not available');
    expect(ctx.deliveryRows).toHaveLength(0);
    expect(ctx.events).toHaveLength(0);
    expect(ctx.assignments).toHaveLength(0);
  });

  it('leaves Express and Flexible tariffs active when a V1 quote is refused', async () => {
    const ctx = context();
    seedLegacyTariff(ctx, tariff('2.00', '1.00', 0, 100_000));
    ctx.configs.unshift(
      classTariff('express', 'EXPRESS', '9.00'),
      classTariff('flexible', 'FLEXIBLE', '1.00'),
    );

    await expect(ctx.deliveries.quote(pins())).rejects.toThrow('Bidding is not available');
    await expect(ctx.deliveries.create(CUSTOMER, deliveryBody('1.00'))).rejects.toThrow('Bidding is not available');
    expect(ctx.deliveryRows).toHaveLength(0);
    expect(ctx.configs.filter((row) => row.serviceClass === 'EXPRESS' || row.serviceClass === 'FLEXIBLE')
      .every((row) => row.isActive)).toBe(true);
  });

  it('does not store a V1 price when the marketplace flag is off', async () => {
    const ctx = context();
    seedLegacyTariff(ctx, tariff('2.00', '1.00', 0, 100_000));
    await expect(ctx.deliveries.create(RIDER, deliveryBody('4.00'))).rejects.toThrow('Bidding is not available');
    seedLegacyTariff(ctx, tariff('9.00', '2.00', 0, 100_000));
    expect(ctx.deliveryRows).toHaveLength(0);
    await expect(ctx.deliveries.quote(pins())).rejects.toThrow('Bidding is not available');
  });

  it('rejects an invalid offer before a delivery is stored', async () => {
    const ctx = context();
    seedLegacyTariff(ctx, tariff('2.00', '1.00', 0, 100_000));
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
    await expect(ctx.deliveries.create(CUSTOMER, deliveryBody('1000.00'))).rejects.toThrow('Bidding is not available');
    expect(ctx.deliveryRows).toHaveLength(0);
  });
});

function tariff(baseFee: string, pricePerKilometre: string, minimumTripMetres: number, maximumTripMetres: number) {
  return { baseFee, pricePerKilometre, minimumTripMetres, maximumTripMetres };
}

function seedLegacyTariff(ctx: { configs: Array<Record<string, unknown> & { id: string; isActive: boolean; serviceClass?: string | null }>; audits: unknown[] }, values: ReturnType<typeof tariff>) {
  for (const row of ctx.configs) {
    if ((row.serviceClass ?? null) === null && row.isActive) {
      row.isActive = false;
    }
  }
  const pricingVersion = ctx.configs.reduce((highest, row) => Math.max(highest, Number(row.pricingVersion ?? 0)), 0) + 1;
  ctx.configs.push({
    id: `legacy-${pricingVersion}`,
    isActive: true,
    serviceClass: null,
    currency: 'USD',
    pricingVersion,
    ...values,
  });
  ctx.audits.push({ pricingVersion });
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

function includedPublished() {
  return published('included', ServiceClass.EXPRESS, PricingModel.INCLUDED_DISTANCE, '5.00', {
    pricePerKilometre: '0.80',
    includedMetres: 5_000,
    minimumTripMetres: 100,
    maximumTripMetres: 100_000,
  });
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
    async $transaction<T>(callback: (tx: object) => Promise<T>) {
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

  it('refuses a quote and a delivery when the flag is absent or not exactly true', async () => {
    const ctx = context();
    seedLegacyTariff(ctx, tariff('2.00', '1.00', 0, 100_000));
    ctx.configs.unshift(classTariff('express', 'EXPRESS', '9.00'), classTariff('flexible', 'FLEXIBLE', '1.00'));
    const body = { ...pins(), serviceClass: 'EXPRESS', suggestedPrice: '0.01', pricingVersion: 99, basisPoints: 5_000 };

    delete process.env.V2_MARKETPLACE_ENABLED;
    await expect(ctx.deliveries.quote(body)).rejects.toThrow('Bidding is not available');

    process.env.V2_MARKETPLACE_ENABLED = 'false';
    await expect(ctx.deliveries.quote(body)).rejects.toThrow('Bidding is not available');
    await expect(ctx.deliveries.create(CUSTOMER, {
      ...deliveryBody('4.00'),
      serviceClass: 'FLEXIBLE',
      suggestedPrice: '0.01',
      pricingModel: 'FIXED',
      basisPoints: 5_000,
    })).rejects.toThrow('Bidding is not available');
    expect(ctx.deliveryRows).toHaveLength(0);
    expect(ctx.events).toHaveLength(0);
    expect(ctx.assignments).toHaveLength(0);
    expect(ctx.audits).toHaveLength(1);
  });

  it('quotes the published class tariff and does not fall back when the flag is exactly true', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const now = new Date('2026-01-05T10:00:00.000Z');
    const ctx = context({ metres: 1_500, now });
    seedLegacyTariff(ctx, tariff('2.00', '1.00', 0, 100_000));
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

  it('stores an unchanged customer offer and an edited offer apart from the agreed price', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = context({ now: new Date('2026-10-24T08:00:00.000Z') });
    ctx.configs.unshift(published('express', ServiceClass.EXPRESS, PricingModel.FIXED, '9.00'));
    const unchanged = await ctx.deliveries.create(CUSTOMER, {
      ...deliveryBody('9.00'),
      serviceClass: 'EXPRESS',
      payer: undefined,
      paymentMethod: undefined,
      suggestedPrice: '0.01',
    });
    expect(unchanged).toMatchObject({ suggestedPrice: '9.00', offeredPrice: null });
    expect(ctx.deliveryRows[0]).toMatchObject({ suggestedPrice: '9.00', customerOffer: '9.00', price: null });

    const edited = await ctx.deliveries.create(CUSTOMER, {
      ...deliveryBody('4.00'),
      serviceClass: 'EXPRESS',
      payer: undefined,
      paymentMethod: undefined,
      suggestedPrice: '12.00',
    });
    expect(edited).toMatchObject({ suggestedPrice: '9.00', offeredPrice: null });
    expect(ctx.deliveryRows[1]).toMatchObject({ suggestedPrice: '9.00', customerOffer: '4.00', price: null });
  });

  it('quotes and stores an included-distance price without using the client snapshot', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const quoted = context({ metres: 3_000, now: new Date('2026-10-27T10:00:00.000Z') });
    quoted.configs.push(includedPublished());
    await expect(quoted.deliveries.quote({ ...pins(), serviceClass: 'EXPRESS' })).resolves.toMatchObject({
      distanceMeters: 3_000,
      pricingVersion: 9,
      pricingModel: 'INCLUDED_DISTANCE',
      serviceClass: 'EXPRESS',
      basisPoints: 0,
      pricingWindow: null,
      suggestedPrice: '5.00',
    });

    const ctx = context({ metres: 6_000, now: new Date('2026-10-27T10:00:00.000Z') });
    seedLegacyTariff(ctx, tariff('2.00', '0.50', 100, 100_000));
    ctx.configs.unshift(includedPublished());
    await expect(ctx.deliveries.quote({ ...pins(), serviceClass: 'EXPRESS' })).resolves.toMatchObject({
      suggestedPrice: '5.80',
      pricingModel: 'INCLUDED_DISTANCE',
      pricingVersion: 9,
    });
    const created = await ctx.deliveries.create(CUSTOMER, {
      ...deliveryBody('4.00'),
      serviceClass: 'EXPRESS',
      deliverBy: '2026-10-27T18:00:00.000Z',
      payer: undefined,
      paymentMethod: undefined,
      suggestedPrice: '0.01',
      pricingVersion: 1,
      pricingModel: 'FIXED',
    });
    expect(created).toMatchObject({
      suggestedPrice: '5.80',
      pricingVersion: 9,
      pricingModel: 'INCLUDED_DISTANCE',
      serviceClass: 'EXPRESS',
      offeredPrice: null,
    });
    expect(ctx.deliveryRows[0]).toMatchObject({ suggestedPrice: '5.80', customerOffer: '4.00', price: null, pricingVersion: 9 });
    expect(ctx.configs.find((row) => row.serviceClass === null)).toMatchObject({
      isActive: true,
      baseFee: '2.00',
      pricePerKilometre: '0.50',
      pricingVersion: 1,
    });
  });

  it('opens a V2 request from the class tariff when the flag is on and ignores the client snapshot', async () => {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
    const ctx = context({ now: new Date('2026-10-24T08:00:00.000Z') });
    seedLegacyTariff(ctx, tariff('2.00', '1.00', 0, 100_000));
    ctx.configs.unshift(published('express', ServiceClass.EXPRESS, PricingModel.FIXED, '9.00'));
    ctx.configs.unshift(published('flexible', ServiceClass.FLEXIBLE, PricingModel.FIXED, '9.00'));
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

    const undated = await ctx.deliveries.create(CUSTOMER, {
      ...body,
      deliverBy: undefined,
      serviceClass: 'FLEXIBLE',
      payer: undefined,
      paymentMethod: undefined,
    });
    expect(undated).toMatchObject({ serviceClass: 'FLEXIBLE', deliverBy: null, suggestedPrice: '9.00' });
    expect(ctx.deliveryRows[0]).toMatchObject({
      deliverBy: null,
      searchStartedAt: new Date('2026-10-24T08:00:00.000Z'),
      nextRetryAt: new Date('2026-10-24T08:06:00.000Z'),
      autoRetryCount: 0,
      searchGeneration: 0,
    });

    const created = await ctx.deliveries.create(CUSTOMER, { ...body, payer: undefined, paymentMethod: undefined });
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
    expect(ctx.deliveryRows[1]).toMatchObject({
      price: null,
      suggestedPrice: '9.00',
      pricingVersion: 9,
      serviceClass: 'EXPRESS',
      deliverBy: new Date('2026-10-24T18:00:00.000Z'),
      searchGeneration: 0,
      searchStartedAt: new Date('2026-10-24T08:00:00.000Z'),
      nextRetryAt: new Date('2026-10-24T08:06:00.000Z'),
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
      distanceMeters: null,
      openBidCount: 0,
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
    expect(page.data[0]?.openBidCount).toBe(0);
  });

  it('counts only open unexpired bids for each waiting delivery on the page', async () => {
    const future = new Date('2099-01-01T00:00:00.000Z');
    const past = new Date('2020-01-01T00:00:00.000Z');
    const waiting = {
      ...row('waiting', 'account-a', 'CREATED', sameTime, 'Pickup', 'Drop-off'),
      serviceClass: 'FLEXIBLE' as const,
      deliverBy: future,
    };
    const another = {
      ...row('another', 'account-a', 'CREATED', older, 'Second pickup', 'Second drop-off'),
      serviceClass: 'EXPRESS' as const,
      deliverBy: future,
    };
    const expiredRequest = {
      ...row('closed-window', 'account-a', 'CREATED', older, 'Late pickup', 'Late drop-off'),
      serviceClass: 'FLEXIBLE' as const,
      deliverBy: past,
    };
    const assigned = {
      ...row('assigned', 'account-a', 'RIDER_ASSIGNED', sameTime, 'Assigned pickup', 'Assigned drop-off'),
      serviceClass: 'FLEXIBLE' as const,
      deliverBy: future,
    };
    const openEnded = {
      ...row('open-ended', 'account-a', 'CREATED', older, 'Open pickup', 'Open drop-off'),
      serviceClass: 'FLEXIBLE' as const,
      deliverBy: null,
    };
    const searching = row('searching', 'account-a', 'SEARCHING', sameTime, 'Search pickup', 'Search drop-off');
    const prisma = listPrisma(
      [waiting, another, expiredRequest, assigned, openEnded, searching],
      [
        { deliveryId: 'waiting', status: 'OPEN' },
        { deliveryId: 'waiting', status: 'WITHDRAWN' },
        { deliveryId: 'waiting', status: 'EXPIRED' },
        { deliveryId: 'waiting', status: 'ACCEPTED' },
        { deliveryId: 'waiting', status: 'SUPERSEDED' },
        { deliveryId: 'another', status: 'OPEN' },
        { deliveryId: 'another', status: 'OPEN' },
        { deliveryId: 'another', status: 'OPEN' },
        { deliveryId: 'closed-window', status: 'OPEN' },
        { deliveryId: 'open-ended', status: 'OPEN' },
        { deliveryId: 'assigned', status: 'OPEN' },
        { deliveryId: 'searching', status: 'OPEN' },
      ],
    );
    const service = new DeliveryService(prisma as never);
    const page = await service.list(customer('account-a'), {});
    const counts = new Map(page.data.map((delivery) => [delivery.id, delivery.openBidCount]));

    expect(counts.get('waiting')).toBe(1);
    expect(counts.get('another')).toBe(3);
    expect(counts.get('closed-window')).toBe(0);
    expect(counts.get('open-ended')).toBe(1);
    expect(counts.get('assigned')).toBe(0);
    expect(counts.get('searching')).toBe(0);
    expect(prisma.bidCalls).toEqual({ groupBy: 1, updateMany: 0 });
  });
});

function customer(customerAccountId: string) {
  return { userId: 'user-1', role: UserRole.CUSTOMER, customerAccountId };
}

type ListedDelivery = {
  id: string;
  customerId: string;
  status: DeliveryStatus;
  createdAt: Date;
  pickupAddress: string;
  dropoffAddress: string;
  pickupContactPhone: string;
  serviceClass?: string;
  deliverBy?: Date | null;
  currency?: string;
  suggestedPrice?: string;
  price?: string | null;
};

function row(
  id: string,
  customerId: string,
  status: DeliveryStatus,
  createdAt: Date,
  pickupAddress: string,
  dropoffAddress: string,
  pickupContactPhone = '+263771234567',
): ListedDelivery {
  return { id, customerId, status, createdAt, pickupAddress, dropoffAddress, pickupContactPhone };
}

function listPrisma(rows: ListedDelivery[], bids: Array<{ deliveryId: string; status: string }> = []) {
  const bidCalls = { groupBy: 0, updateMany: 0 };
  return {
    bidCalls,
    bid: {
      async updateMany() {
        bidCalls.updateMany += 1;
        return { count: 0 };
      },
      async groupBy({ where }: { where: BidCountWhere }) {
        bidCalls.groupBy += 1;
        const counts = new Map<string, number>();
        for (const bid of bids) {
          const delivery = rows.find((item) => item.id === bid.deliveryId);
          if (!delivery || !where.deliveryId.in.includes(bid.deliveryId) || bid.status !== where.status) {
            continue;
          }
          if (!deadlineStillOpen(delivery, where.delivery)) {
            continue;
          }
          counts.set(bid.deliveryId, (counts.get(bid.deliveryId) ?? 0) + 1);
        }
        return [...counts.entries()].map(([deliveryId, count]) => ({
          deliveryId,
          _count: { _all: count },
        }));
      },
    },
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

type BidCountWhere = {
  deliveryId: { in: string[] };
  status: string;
  delivery?: { OR?: Array<{ deliverBy: Date | null } | { deliverBy: { gt: Date } }> };
};

function deadlineStillOpen(delivery: { deliverBy?: Date | null }, filter: BidCountWhere['delivery']): boolean {
  const clauses = filter?.OR ?? [];
  return clauses.some((clause) => {
    if (!('deliverBy' in clause)) {
      return false;
    }
    if (clause.deliverBy === null) {
      return delivery.deliverBy == null;
    }
    if (!('gt' in clause.deliverBy)) {
      return false;
    }
    return delivery.deliverBy instanceof Date && delivery.deliverBy.getTime() > clause.deliverBy.gt.getTime();
  });
}

function matches(item: ListedDelivery, where: ListWhere): boolean {
  if (item.customerId !== where.customerId) {
    return false;
  }
  if (where.status && !where.status.in.includes(item.status)) {
    return false;
  }
  return true;
}
