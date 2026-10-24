import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ClassPricingService } from './class-pricing.service.js';

const ADMIN = { userId: 'admin-1' };

describe('ClassPricingService', () => {
  it('publishes each model without seeding a class tariff', async () => {
    const ctx = context();
    await expect(ctx.service.currentClasses()).resolves.toEqual({ express: null, flexible: null });
    await expect(ctx.service.currentClass('EXPRESS')).rejects.toThrow('Express pricing is not available');

    const fixed = await ctx.service.publish(ADMIN, 'EXPRESS', fixedTariff('3.50'));
    expect(fixed).toMatchObject({
      serviceClass: 'EXPRESS',
      pricingModel: 'FIXED',
      pricingVersion: 1,
      currency: 'USD',
      baseFee: '3.50',
      pricePerKilometre: '0.00',
      isActive: true,
      tiers: [],
      windows: [],
    });

    const perKilometre = await ctx.service.publish(ADMIN, 'FLEXIBLE', {
      pricingModel: 'PER_KILOMETRE',
      pricePerKilometre: '1.25',
      minimumTripMetres: 0,
      maximumTripMetres: 10_000,
    });
    expect(perKilometre).toMatchObject({ pricingModel: 'PER_KILOMETRE', baseFee: '0.00', pricePerKilometre: '1.25', pricingVersion: 2 });

    const basePlus = await ctx.service.publish(ADMIN, 'EXPRESS', {
      pricingModel: 'BASE_PLUS_PER_KILOMETRE',
      baseFee: '2.00',
      pricePerKilometre: '0.80',
      minimumTripMetres: 100,
      maximumTripMetres: 20_000,
    });
    expect(basePlus).toMatchObject({ pricingModel: 'BASE_PLUS_PER_KILOMETRE', baseFee: '2.00', pricePerKilometre: '0.80', pricingVersion: 3 });

    const tiers = await ctx.service.publish(ADMIN, 'FLEXIBLE', {
      pricingModel: 'DISTANCE_TIERS',
      minimumTripMetres: 0,
      maximumTripMetres: 5_000,
      tiers: [
        { position: 1, upToMetres: 1_000, amount: '10.00' },
        { position: 2, upToMetres: 5_000, amount: '20.00' },
      ],
      windows: [midnightWindow()],
    });
    expect(tiers.tiers).toEqual([
      expect.objectContaining({ position: 1, upToMetres: 1_000, amount: '10.00' }),
      expect.objectContaining({ position: 2, upToMetres: 5_000, amount: '20.00' }),
    ]);
    expect(tiers.windows).toEqual([
      expect.objectContaining({ kind: 'NIGHT', enabled: true, startsAt: '22:00', endsAt: '02:00', adjustmentBasisPoints: 1_000 }),
    ]);
    expect(ctx.configs.filter((row) => row.isActive).map((row) => row.serviceClass).sort()).toEqual(['EXPRESS', 'FLEXIBLE']);
  });

  it('publishes one class without changing the other class or the V1 tariff', async () => {
    const ctx = context();
    ctx.configs.push(v1Tariff());
    await ctx.service.publish(ADMIN, 'FLEXIBLE', fixedTariff('1.00'));
    const express = await ctx.service.publish(ADMIN, 'EXPRESS', fixedTariff('9.00'));
    await ctx.service.publish(ADMIN, 'EXPRESS', fixedTariff('8.00'));

    expect(express.pricingVersion).toBe(3);
    expect(ctx.configs.filter((row) => row.serviceClass === 'FLEXIBLE')).toEqual([
      expect.objectContaining({ isActive: true, baseFee: '1.00', pricingVersion: 2 }),
    ]);
    expect(ctx.configs.find((row) => row.serviceClass === null)).toMatchObject({ isActive: true, baseFee: '2.00', pricingVersion: 1 });
    expect(ctx.configs.find((row) => row.serviceClass === 'EXPRESS' && row.pricingVersion === 3)).toMatchObject({ isActive: false, baseFee: '9.00' });
    expect(ctx.audits.map((row) => row.previousVersion)).toEqual([null, null, 3]);
  });

  it('keeps a disabled window on the historical version when a later version enables it', async () => {
    const ctx = context();
    const published = await ctx.service.publish(ADMIN, 'EXPRESS', {
      ...fixedTariff('4.00'),
      windows: [{ ...midnightWindow(), enabled: false }],
    });
    const windowId = published.windows[0]?.id ?? '';
    const unchanged = await ctx.service.setWindowEnabled(ADMIN, 'EXPRESS', windowId, { enabled: false });
    expect(unchanged.pricingVersion).toBe(published.pricingVersion);
    expect(ctx.audits).toHaveLength(1);

    const enabled = await ctx.service.setWindowEnabled(ADMIN, 'EXPRESS', windowId, { enabled: true });
    expect(enabled.pricingVersion).toBe(2);
    expect(enabled.windows[0]).toMatchObject({ enabled: true, startsAt: '22:00', endsAt: '02:00' });
    expect(enabled.windows[0]?.id).not.toBe(windowId);
    const original = ctx.configs.find((row) => row.pricingVersion === 1);
    expect(original).toMatchObject({ isActive: false });
    expect(original?.windows[0]).toMatchObject({ id: windowId, enabled: false });
    expect(ctx.audits).toEqual([
      expect.objectContaining({ actorId: 'admin-1', previousVersion: null, nextVersion: 1, createdAt: expect.any(Date) }),
      expect.objectContaining({ actorId: 'admin-1', previousVersion: 1, nextVersion: 2, createdAt: expect.any(Date) }),
    ]);
  });

  it('rejects invalid tariffs before publication', async () => {
    const ctx = context();
    await expect(ctx.service.publish(ADMIN, 'EXPRESS', { ...fixedTariff('-1.00') })).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctx.service.publish(ADMIN, 'EXPRESS', { ...fixedTariff('1.00'), minimumTripMetres: 10, maximumTripMetres: 10 })).rejects.toThrow('greater than the minimum');
    await expect(ctx.service.publish(ADMIN, 'EXPRESS', { ...fixedTariff('1.00'), pricePerKilometre: '1.00' })).rejects.toThrow('does not apply');
    await expect(ctx.service.publish(ADMIN, 'FLEXIBLE', {
      pricingModel: 'DISTANCE_TIERS',
      minimumTripMetres: 0,
      maximumTripMetres: 5_000,
      tiers: [
        { position: 1, upToMetres: 1_000, amount: '1.00' },
        { position: 2, upToMetres: 4_000, amount: '1.00' },
      ],
    })).rejects.toThrow('do not cover the configured range');
    await expect(ctx.service.publish(ADMIN, 'EXPRESS', {
      ...fixedTariff('1.00'),
      windows: [{ ...midnightWindow(), startsAt: '24:00' }],
    })).rejects.toThrow('window time');
    await expect(ctx.service.publish(ADMIN, 'EXPRESS', {
      ...fixedTariff('1.00'),
      windows: [{ ...midnightWindow(), daysOfWeek: [0] }],
    })).rejects.toThrow('window days');
    await expect(ctx.service.publish(ADMIN, 'EXPRESS', {
      ...fixedTariff('1.00'),
      windows: [{ ...midnightWindow(), adjustmentBasisPoints: -20_000 }],
    })).rejects.toThrow('Suggested price is negative');
    expect(ctx.configs).toHaveLength(0);
    expect(ctx.audits).toHaveLength(0);
  });

  it('rolls back a publication when the audit insert fails', async () => {
    const ctx = context();
    await ctx.service.publish(ADMIN, 'EXPRESS', fixedTariff('3.00'));
    ctx.failAudit = true;
    await expect(ctx.service.publish(ADMIN, 'EXPRESS', fixedTariff('4.00'))).rejects.toThrow('audit failed');
    expect(ctx.configs).toEqual([
      expect.objectContaining({ pricingVersion: 1, isActive: true, baseFee: '3.00', serviceClass: 'EXPRESS' }),
    ]);
    expect(ctx.audits).toHaveLength(1);
  });

  it('serializes concurrent publications so one class has one active version', async () => {
    const ctx = context();
    const [first, second] = await Promise.all([
      ctx.service.publish(ADMIN, 'EXPRESS', fixedTariff('3.00')),
      ctx.service.publish(ADMIN, 'EXPRESS', fixedTariff('4.00')),
    ]);
    const versions = [first.pricingVersion, second.pricingVersion].sort((left, right) => left - right);
    expect(versions).toEqual([1, 2]);
    expect(ctx.configs.filter((row) => row.serviceClass === 'EXPRESS' && row.isActive)).toHaveLength(1);
    expect(ctx.audits).toHaveLength(2);
    expect(ctx.locked).toBe(true);
  });

  it('lists audit history for an admin', async () => {
    const ctx = context();
    await ctx.service.publish(ADMIN, 'EXPRESS', fixedTariff('3.00'));
    const page = await ctx.service.audits({});
    expect(page.data).toEqual([
      expect.objectContaining({ actorId: 'admin-1', previousVersion: null, nextVersion: 1 }),
    ]);
    expect(page.data[0]?.createdAt).toEqual(expect.any(String));
    expect(page.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
  });
});

function fixedTariff(baseFee: string) {
  return {
    pricingModel: 'FIXED',
    baseFee,
    minimumTripMetres: 0,
    maximumTripMetres: 10_000,
  };
}

function midnightWindow() {
  return {
    kind: 'NIGHT',
    enabled: true,
    daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    startsAt: '22:00',
    endsAt: '02:00',
    adjustmentBasisPoints: 1_000,
  };
}

function v1Tariff() {
  return row({
    id: 'v1',
    serviceClass: null,
    pricingVersion: 1,
    pricingModel: 'BASE_PLUS_PER_KILOMETRE',
    baseFee: '2.00',
    pricePerKilometre: '1.00',
  });
}

type StoredConfig = ReturnType<typeof row>;

function row(overrides: Record<string, unknown>): {
  id: string;
  isActive: boolean;
  serviceClass: string | null;
  pricingVersion: number;
  pricingModel: string;
  currency: string;
  baseFee: string;
  pricePerKilometre: string;
  minimumTripMetres: number;
  maximumTripMetres: number;
  createdById: string;
  tiers: Array<Record<string, unknown> & { id: string; position: number; upToMetres: number | null; amount: string }>;
  windows: Array<Record<string, unknown> & { id: string; enabled: boolean; createdAt: Date; daysOfWeek: number[] }>;
} {
  return {
    id: 'config',
    isActive: true,
    serviceClass: null,
    pricingVersion: 1,
    pricingModel: 'FIXED',
    currency: 'USD',
    baseFee: '0.00',
    pricePerKilometre: '0.00',
    minimumTripMetres: 0,
    maximumTripMetres: 10_000,
    createdById: 'admin-1',
    tiers: [],
    windows: [],
    ...overrides,
  };
}

function context() {
  const configs: StoredConfig[] = [];
  const audits: Array<Record<string, unknown> & { id: string; createdAt: Date }> = [];
  const state = { failAudit: false, locked: false };
  let nextId = 1;
  const mutex = createMutex();

  function clone(): StoredConfig[] {
    return configs.map((item) => ({
      ...item,
      tiers: item.tiers.map((tier) => ({ ...tier })),
      windows: item.windows.map((window) => ({ ...window, daysOfWeek: [...window.daysOfWeek], createdAt: new Date(window.createdAt) })),
    }));
  }

  const db = {
    deliveryPricingConfig: {
      async findFirst(args?: { where?: { isActive?: boolean; serviceClass?: string | null }; orderBy?: { pricingVersion?: 'desc' } | Array<{ createdAt?: 'asc'; id?: 'asc' }> }) {
        const where = args?.where;
        let rows = configs.filter((item) => {
          if (!where) return true;
          if (where.isActive !== undefined && item.isActive !== where.isActive) return false;
          if (Object.prototype.hasOwnProperty.call(where, 'serviceClass') && item.serviceClass !== where.serviceClass) return false;
          return true;
        });
        if (!Array.isArray(args?.orderBy) && args?.orderBy?.pricingVersion === 'desc') {
          rows = [...rows].sort((left, right) => right.pricingVersion - left.pricingVersion);
        }
        return rows[0] ?? null;
      },
      async update({ where, data }: { where: { id: string }; data: { isActive?: boolean; baseFee?: string } }) {
        if ('baseFee' in data || 'pricePerKilometre' in data) throw new Error('historical tariff fees were edited');
        const item = configs.find((row) => row.id === where.id);
        if (!item) throw new Error('missing tariff');
        Object.assign(item, data);
        return item;
      },
      async create({ data }: { data: Record<string, unknown> & { tiers?: { create?: Array<Record<string, unknown>> }; windows?: { create?: Array<Record<string, unknown>> } } }) {
        const serviceClass = (data.serviceClass ?? null) as string | null;
        if (data.isActive !== false && configs.some((item) => item.isActive && item.serviceClass === serviceClass)) {
          throw new Error('one active tariff for this class');
        }
        if (configs.some((item) => item.pricingVersion === data.pricingVersion)) {
          throw new Error('pricing version already exists');
        }
        const created = row({
          id: `config-${nextId}`,
          ...data,
          serviceClass,
          tiers: (data.tiers?.create ?? []).map((tier) => ({ id: `tier-${nextId}`, ...tier })),
          windows: (data.windows?.create ?? []).map((window) => ({
            id: `window-${nextId}`,
            createdAt: new Date(),
            ...window,
          })),
        });
        nextId += 1;
        configs.push(created);
        return created;
      },
    },
    pricingConfigAudit: {
      async create({ data }: { data: Record<string, unknown> }) {
        if (state.failAudit) throw new Error('audit failed');
        const created = { id: `audit-${audits.length + 1}`, createdAt: new Date(), ...data };
        audits.push(created);
        return created;
      },
      async count() {
        return audits.length;
      },
      async findMany({ skip = 0, take = 20 }: { skip?: number; take?: number }) {
        return [...audits].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()).slice(skip, skip + take);
      },
    },
    async $queryRaw(strings: TemplateStringsArray) {
      return strings.join(' ');
    },
    async $transaction<T>(callback: (tx: typeof db & { $queryRaw: (strings: TemplateStringsArray) => Promise<string> }) => Promise<T>) {
      let snapshot = clone();
      const auditSnapshot = audits.map((item) => ({ ...item }));
      let release: (() => void) | undefined;
      const tx = {
        ...db,
        async $queryRaw(strings: TemplateStringsArray) {
          const sql = strings.join(' ');
          if (sql.includes('pg_advisory_xact_lock(724311, 2)')) {
            state.locked = true;
            release = await mutex.acquire();
            snapshot = clone();
          }
          return sql;
        },
      };
      try {
        return await callback(tx);
      } catch (error) {
        configs.splice(0, configs.length, ...snapshot);
        audits.splice(0, audits.length, ...auditSnapshot);
        throw error;
      } finally {
        release?.();
      }
    },
  };
  return {
    service: new ClassPricingService(db as unknown as PrismaService),
    configs,
    audits,
    get locked() {
      return state.locked;
    },
    set failAudit(value: boolean) {
      state.failAudit = value;
    },
  };
}

function createMutex() {
  let tail = Promise.resolve();
  return {
    acquire() {
      const previous = tail;
      let release: () => void = () => undefined;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      return previous.then(() => release);
    },
  };
}
