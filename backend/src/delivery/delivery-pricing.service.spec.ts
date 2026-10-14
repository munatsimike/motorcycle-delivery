import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { DeliveryPricingService } from './delivery-pricing.service.js';

const ADMIN = { userId: 'admin-1' };

describe('DeliveryPricingService', () => {
  it('versions a tariff change and leaves the previous amounts in place', async () => {
    const ctx = context();
    await expect(ctx.service.current()).rejects.toBeInstanceOf(NotFoundException);

    const first = await ctx.service.replace(ADMIN, tariff('2.00', '1.00', 0, 50_000));
    expect(first).toEqual({
      pricingVersion: 1,
      currency: 'USD',
      baseFee: '2.00',
      pricePerKilometre: '1.00',
      minimumTripMetres: 0,
      maximumTripMetres: 50_000,
    });

    const second = await ctx.service.replace(ADMIN, tariff('3.50', '0.80', 100, 80_000));
    expect(second.pricingVersion).toBe(2);
    expect(ctx.configs).toEqual([
      expect.objectContaining({ pricingVersion: 1, isActive: false, baseFee: '2.00', pricePerKilometre: '1.00' }),
      expect.objectContaining({ pricingVersion: 2, isActive: true, baseFee: '3.50', createdById: 'admin-1' }),
    ]);

    const repeat = await ctx.service.replace(ADMIN, {
      ...tariff('3.50', '0.80', 100, 80_000),
      pricingVersion: 99,
      currency: 'USD',
      offeredPrice: '1.00',
    });
    expect(repeat.pricingVersion).toBe(2);
    expect(ctx.configs).toHaveLength(2);
  });

  it('rejects an invalid tariff without changing the active row', async () => {
    const ctx = context();
    await ctx.service.replace(ADMIN, tariff('2.00', '1.00', 0, 50_000));

    await expect(ctx.service.replace(ADMIN, tariff('-1.00', '1.00', 0, 50_000))).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctx.service.replace(ADMIN, tariff('2.00', '1.00', 500, 500))).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctx.service.replace(ADMIN, { ...tariff('2.00', '1.00', 0, 50_000), currency: 'ZWG' }))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(ctx.configs).toEqual([
      expect.objectContaining({ pricingVersion: 1, isActive: true, baseFee: '2.00' }),
    ]);
  });
});

function tariff(baseFee: string, pricePerKilometre: string, minimumTripMetres: number, maximumTripMetres: number) {
  return { baseFee, pricePerKilometre, minimumTripMetres, maximumTripMetres };
}

function context() {
  const configs: Array<Record<string, unknown>> = [];
  let nextId = 1;
  const db = {
    deliveryPricingConfig: {
      async findFirst({ where }: { where: { isActive: boolean } }) {
        return configs.find((row) => row.isActive === where.isActive) ?? null;
      },
      async update({ where, data }: { where: { id: string }; data: { isActive?: boolean; baseFee?: string } }) {
        if ('baseFee' in data || 'pricePerKilometre' in data) {
          throw new Error('historical tariff fees were edited');
        }
        const row = configs.find((item) => item.id === where.id);
        if (!row) throw new Error('missing tariff');
        Object.assign(row, data);
        return row;
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const row = { id: `config-${nextId}`, ...data };
        nextId += 1;
        configs.push(row);
        return row;
      },
    },
    delivery: {
      async update() {
        throw new Error('delivery changed');
      },
    },
    async $queryRaw() {
      return [];
    },
    async $transaction<T>(callback: (tx: typeof db) => Promise<T>) {
      return callback(db);
    },
  };
  return {
    service: new DeliveryPricingService(db as unknown as PrismaService),
    configs,
  };
}
