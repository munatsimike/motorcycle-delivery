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
    expect(ctx.audits).toEqual([
      expect.objectContaining({ actorId: 'admin-1', previousVersion: null, nextVersion: 1, createdAt: expect.any(Date) }),
      expect.objectContaining({ actorId: 'admin-1', previousVersion: 1, nextVersion: 2, createdAt: expect.any(Date) }),
    ]);
    expect(ctx.configs.every((row) => row.serviceClass === null && row.pricingModel === 'BASE_PLUS_PER_KILOMETRE')).toBe(true);
  });

  it('quotes the null-class tariff when Express and Flexible rows are also active', async () => {
    const ctx = context();
    await ctx.service.replace(ADMIN, tariff('2.00', '1.00', 0, 50_000));
    ctx.configs.unshift(
      { id: 'express', isActive: true, serviceClass: 'EXPRESS', pricingVersion: 9, baseFee: '9.00', pricePerKilometre: '4.00', minimumTripMetres: 0, maximumTripMetres: 50_000 },
      { id: 'flexible', isActive: true, serviceClass: 'FLEXIBLE', pricingVersion: 8, baseFee: '1.00', pricePerKilometre: '0.10', minimumTripMetres: 0, maximumTripMetres: 50_000 },
    );

    await expect(ctx.service.current()).resolves.toEqual({
      pricingVersion: 1,
      currency: 'USD',
      baseFee: '2.00',
      pricePerKilometre: '1.00',
      minimumTripMetres: 0,
      maximumTripMetres: 50_000,
    });
  });

  it('keeps historical rows and one active tariff for each service class', async () => {
    const ctx = context();
    await ctx.service.replace(ADMIN, tariff('2.00', '1.00', 0, 50_000));
    ctx.configs.unshift(
      { id: 'express', isActive: true, serviceClass: 'EXPRESS', pricingVersion: 9, baseFee: '9.00', pricePerKilometre: '4.00', minimumTripMetres: 0, maximumTripMetres: 50_000 },
      { id: 'flexible', isActive: true, serviceClass: 'FLEXIBLE', pricingVersion: 8, baseFee: '1.00', pricePerKilometre: '0.10', minimumTripMetres: 0, maximumTripMetres: 50_000 },
    );

    await ctx.service.replace(ADMIN, tariff('3.50', '0.80', 100, 80_000));

    expect(ctx.configs).toEqual([
      expect.objectContaining({ id: 'express', isActive: true, serviceClass: 'EXPRESS', baseFee: '9.00' }),
      expect.objectContaining({ id: 'flexible', isActive: true, serviceClass: 'FLEXIBLE', baseFee: '1.00' }),
      expect.objectContaining({ pricingVersion: 1, isActive: false, serviceClass: null, baseFee: '2.00', pricePerKilometre: '1.00' }),
      expect.objectContaining({ pricingVersion: 10, isActive: true, serviceClass: null, baseFee: '3.50' }),
    ]);
    expect(ctx.audits.at(-1)).toEqual(expect.objectContaining({
      actorId: 'admin-1',
      previousVersion: 1,
      nextVersion: 10,
    }));
  });

  it('rolls the tariff replacement back when the audit insert fails', async () => {
    const ctx = context();
    await ctx.service.replace(ADMIN, tariff('2.00', '1.00', 0, 50_000));
    ctx.failAudit = true;

    await expect(ctx.service.replace(ADMIN, tariff('3.50', '0.80', 100, 80_000))).rejects.toThrow('audit failed');

    expect(ctx.configs).toEqual([
      expect.objectContaining({ pricingVersion: 1, isActive: true, baseFee: '2.00', pricePerKilometre: '1.00' }),
    ]);
    expect(ctx.audits).toEqual([
      expect.objectContaining({ actorId: 'admin-1', previousVersion: null, nextVersion: 1 }),
    ]);
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
  const audits: Array<Record<string, unknown>> = [];
  const state = { failAudit: false };
  let nextId = 1;
  const db = {
    deliveryPricingConfig: {
      async findFirst(args?: { where?: { isActive?: boolean; serviceClass?: string | null }; orderBy?: { pricingVersion?: 'asc' | 'desc' } }) {
        const where = args?.where;
        let rows = configs.filter((row) => {
          if (!where) return true;
          if (where.isActive !== undefined && row.isActive !== where.isActive) return false;
          if (Object.prototype.hasOwnProperty.call(where, 'serviceClass') && (row.serviceClass ?? null) !== where.serviceClass) {
            return false;
          }
          return true;
        });
        if (args?.orderBy?.pricingVersion === 'desc') {
          rows = [...rows].sort((left, right) => Number(right.pricingVersion) - Number(left.pricingVersion));
        }
        return rows[0] ?? null;
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
        const row = { id: `config-${nextId}`, serviceClass: null, ...data };
        nextId += 1;
        configs.push(row);
        return row;
      },
    },
    pricingConfigAudit: {
      async create({ data }: { data: Record<string, unknown> }) {
        if (state.failAudit) throw new Error('audit failed');
        const row = { id: `audit-${audits.length + 1}`, createdAt: new Date(), ...data };
        audits.push(row);
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
      const configsSnapshot = configs.map((row) => ({ ...row }));
      const auditsSnapshot = audits.map((row) => ({ ...row }));
      const nextIdSnapshot = nextId;
      try {
        return await callback(db);
      } catch (error) {
        configs.splice(0, configs.length, ...configsSnapshot);
        audits.splice(0, audits.length, ...auditsSnapshot);
        nextId = nextIdSnapshot;
        throw error;
      }
    },
  };
  return {
    service: new DeliveryPricingService(db as unknown as PrismaService),
    configs,
    audits,
    get failAudit() {
      return state.failAudit;
    },
    set failAudit(value: boolean) {
      state.failAudit = value;
    },
  };
}
