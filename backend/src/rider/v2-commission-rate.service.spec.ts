import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { V2CommissionRateService } from './v2-commission-rate.service.js';

const ADMIN = { userId: 'admin-1' } as const;
const NOW = new Date('2026-10-24T07:00:00.000Z');

describe('V2CommissionRateService', () => {
  it('reports no published rate without inventing zero', async () => {
    const ctx = context();
    await expect(ctx.service.current()).resolves.toEqual({ configured: false });
    expect(ctx.rates).toHaveLength(0);
    expect(ctx.audits).toHaveLength(0);
  });

  it('publishes the first percentage and records the administrator', async () => {
    const ctx = context();
    await expect(ctx.service.publish(ADMIN, { percentage: '10' }, NOW)).resolves.toEqual({
      configured: true,
      basisPoints: 1000,
      percentage: '10',
      rateVersion: 1,
      createdById: 'admin-1',
      createdAt: NOW.toISOString(),
    });
    expect(ctx.rates).toEqual([
      expect.objectContaining({ rateVersion: 1, basisPoints: 1000, isActive: true, createdById: 'admin-1' }),
    ]);
    expect(ctx.audits).toEqual([
      expect.objectContaining({
        actorId: 'admin-1',
        previousVersion: null,
        nextVersion: 1,
        previousBasisPoints: null,
        nextBasisPoints: 1000,
      }),
    ]);
    expect(ctx.locked).toBe(true);
  });

  it('accepts 0% as a published rate', async () => {
    const ctx = context();
    const published = await ctx.service.publish(ADMIN, { percentage: '0' }, NOW);
    expect(published).toEqual(expect.objectContaining({ configured: true, basisPoints: 0, percentage: '0', rateVersion: 1 }));
    await expect(ctx.service.current()).resolves.toEqual(expect.objectContaining({ configured: true, basisPoints: 0 }));
  });

  it('accepts 100%', async () => {
    const ctx = context();
    await expect(ctx.service.publish(ADMIN, { percentage: '100' }, NOW)).resolves.toEqual(
      expect.objectContaining({ basisPoints: 10_000, percentage: '100', rateVersion: 1 }),
    );
  });

  it('keeps the previous version when a later percentage is published', async () => {
    const ctx = context();
    await ctx.service.publish(ADMIN, { percentage: '10.5' }, NOW);
    const next = await ctx.service.publish({ userId: 'admin-2' }, { percentage: '12.25' }, new Date('2026-10-24T08:00:00.000Z'));
    expect(next).toEqual(expect.objectContaining({ basisPoints: 1225, percentage: '12.25', rateVersion: 2, createdById: 'admin-2' }));
    expect(ctx.rates.map((row) => [row.rateVersion, row.basisPoints, row.isActive])).toEqual([
      [1, 1050, false],
      [2, 1225, true],
    ]);
    expect(ctx.audits[1]).toEqual(expect.objectContaining({
      actorId: 'admin-2',
      previousVersion: 1,
      nextVersion: 2,
      previousBasisPoints: 1050,
      nextBasisPoints: 1225,
    }));
  });

  it('does not write a version when the percentage is unchanged', async () => {
    const ctx = context();
    await ctx.service.publish(ADMIN, { percentage: '10.00' }, NOW);
    const again = await ctx.service.publish({ userId: 'admin-2' }, { percentage: '10' }, new Date('2026-10-24T08:00:00.000Z'));
    expect(again.rateVersion).toBe(1);
    expect(again.createdById).toBe('admin-1');
    expect(ctx.rates).toHaveLength(1);
    expect(ctx.audits).toHaveLength(1);
  });

  it.each([
    [{ percentage: '-1' }],
    [{ percentage: '100.01' }],
    [{ percentage: '101' }],
    [{ percentage: '10.555' }],
    [{ percentage: '' }],
    [{ percentage: 'abc' }],
    [{ percentage: 10 }],
    [{ basisPoints: 1000 }],
    [{ percentage: '10', extra: true }],
    [{}],
    [null],
    [[]],
  ])('rejects %j', async (body) => {
    const ctx = context();
    await expect(ctx.service.publish(ADMIN, body, NOW)).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.rates).toHaveLength(0);
    expect(ctx.audits).toHaveLength(0);
  });

  it('serializes concurrent publications onto successive versions', async () => {
    const ctx = context();
    const [first, second] = await Promise.all([
      ctx.service.publish(ADMIN, { percentage: '10' }, NOW),
      ctx.service.publish({ userId: 'admin-2' }, { percentage: '20' }, NOW),
    ]);
    const versions = [first.rateVersion, second.rateVersion].sort((left, right) => left - right);
    expect(versions).toEqual([1, 2]);
    expect(ctx.rates.filter((row) => row.isActive)).toHaveLength(1);
    expect(ctx.audits).toHaveLength(2);
    expect(new Set(ctx.rates.map((row) => row.rateVersion)).size).toBe(2);
  });

  it('lets a concurrent duplicate of the first percentage become a no-op', async () => {
    const ctx = context();
    const [first, second] = await Promise.all([
      ctx.service.publish(ADMIN, { percentage: '0.00' }, NOW),
      ctx.service.publish({ userId: 'admin-2' }, { percentage: '0' }, NOW),
    ]);
    expect([first.basisPoints, second.basisPoints]).toEqual([0, 0]);
    expect(ctx.rates).toHaveLength(1);
    expect(ctx.rates[0]?.isActive).toBe(true);
    expect(ctx.audits).toHaveLength(1);
  });

  it('lists audit history newest first', async () => {
    const ctx = context();
    await ctx.service.publish(ADMIN, { percentage: '0' }, NOW);
    await ctx.service.publish(ADMIN, { percentage: '100' }, new Date('2026-10-24T09:00:00.000Z'));
    const page = await ctx.service.audits({});
    expect(page.data.map((row) => row.nextBasisPoints)).toEqual([10_000, 0]);
    expect(page.data[0]).toEqual(expect.objectContaining({
      actorId: 'admin-1',
      previousPercentage: '0',
      nextPercentage: '100',
      previousVersion: 1,
      nextVersion: 2,
    }));
    expect(page.pagination).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });
  });

  it('rolls back the rate when the audit insert fails', async () => {
    const ctx = context();
    ctx.failAudit = true;
    await expect(ctx.service.publish(ADMIN, { percentage: '5' }, NOW)).rejects.toThrow('audit failed');
    expect(ctx.rates).toHaveLength(0);
    expect(ctx.audits).toHaveLength(0);
    await expect(ctx.service.current()).resolves.toEqual({ configured: false });
  });

  it('does not read the V1 commission policy or wallet fee', async () => {
    const ctx = context();
    await ctx.service.publish(ADMIN, { percentage: '1' }, NOW);
    expect(ctx.v1Touched).toBe(false);
  });
});

type StoredRate = {
  id: string;
  rateVersion: number;
  basisPoints: number;
  isActive: boolean;
  createdById: string;
  createdAt: Date;
};

function context() {
  const rates: StoredRate[] = [];
  const audits: Array<Record<string, unknown> & { id: string; createdAt: Date; nextBasisPoints: number }> = [];
  const state = { failAudit: false, locked: false, v1Touched: false };
  let nextId = 1;
  const mutex = createMutex();

  function cloneRates() {
    return rates.map((row) => ({ ...row, createdAt: new Date(row.createdAt) }));
  }

  const v1 = new Proxy({}, {
    get() {
      state.v1Touched = true;
      throw new Error('V1 commission or wallet was read');
    },
  });

  const db = {
    commissionPolicy: v1,
    walletConfig: v1,
    v2CommissionRate: {
      async findFirst(args?: { where?: { isActive?: boolean }; orderBy?: { rateVersion?: 'desc' } }) {
        let rows = rates.filter((row) => args?.where?.isActive === undefined || row.isActive === args.where.isActive);
        if (args?.orderBy?.rateVersion === 'desc') {
          rows = [...rows].sort((left, right) => right.rateVersion - left.rateVersion);
        }
        return rows[0] ?? null;
      },
      async update({ where, data }: { where: { id: string }; data: { isActive?: boolean } }) {
        const row = rates.find((item) => item.id === where.id);
        if (!row) throw new Error('missing rate');
        Object.assign(row, data);
        return row;
      },
      async create({ data }: { data: Omit<StoredRate, 'id'> }) {
        if (data.isActive !== false && rates.some((row) => row.isActive)) {
          throw new Error('one active V2 commission rate');
        }
        if (rates.some((row) => row.rateVersion === data.rateVersion)) {
          throw new Error('commission rate version already exists');
        }
        const created = { id: `rate-${nextId}`, ...data };
        nextId += 1;
        rates.push(created);
        return created;
      },
    },
    v2CommissionRateAudit: {
      async create({ data }: { data: Record<string, unknown> & { createdAt: Date; nextBasisPoints: number } }) {
        if (state.failAudit) throw new Error('audit failed');
        const created = { id: `audit-${audits.length + 1}`, ...data };
        audits.push(created);
        return created;
      },
      async count() {
        return audits.length;
      },
      async findMany({ skip = 0, take = 20 }: { skip?: number; take?: number }) {
        return [...audits]
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || (left.id < right.id ? 1 : -1))
          .slice(skip, skip + take);
      },
    },
    async $transaction<T>(callback: (tx: typeof db) => Promise<T>) {
      let snapshot = cloneRates();
      const auditSnapshot = audits.map((item) => ({ ...item }));
      let release: (() => void) | undefined;
      const tx = {
        ...db,
        async $queryRaw(strings: TemplateStringsArray) {
          const sql = strings.join(' ');
          if (sql.includes('pg_advisory_xact_lock(724311, 3)')) {
            state.locked = true;
            release = await mutex.acquire();
            snapshot = cloneRates();
          }
          return sql;
        },
      };
      try {
        return await callback(tx);
      } catch (error) {
        rates.splice(0, rates.length, ...snapshot);
        audits.splice(0, audits.length, ...auditSnapshot);
        throw error;
      } finally {
        release?.();
      }
    },
  };

  return {
    service: new V2CommissionRateService(db as unknown as PrismaService),
    rates,
    audits,
    get locked() {
      return state.locked;
    },
    get v1Touched() {
      return state.v1Touched;
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
