import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { WalletConfigService } from './wallet-config.service.js';

const ADMIN = { userId: 'admin-1' };
const NOW = new Date('2026-10-14T09:00:00.000Z');

describe('WalletConfigService', () => {
  it('versions a configuration change and writes the previous and new values', async () => {
    const ctx = context();
    await expect(ctx.service.current()).rejects.toBeInstanceOf(NotFoundException);

    const first = await ctx.service.replace(ADMIN, config('1.00', '1.00', '0.30'), NOW);
    expect(first).toEqual({
      configVersion: 1,
      currency: 'USD',
      welcomeBonus: '1.00',
      defaultBorrowingLimit: '1.00',
      platformFee: '0.30',
    });

    const second = await ctx.service.replace(ADMIN, config('2.00', '0.00', '0.50'), NOW);
    expect(second.configVersion).toBe(2);
    expect(ctx.configs).toEqual([
      expect.objectContaining({
        configVersion: 1,
        isActive: false,
        welcomeBonus: '1.00',
        defaultBorrowingLimit: '1.00',
        platformFee: '0.30',
        createdById: 'admin-1',
      }),
      expect.objectContaining({ configVersion: 2, isActive: true, welcomeBonus: '2.00', createdById: 'admin-1' }),
    ]);
    expect(ctx.audits).toEqual([
      expect.objectContaining({
        configVersion: 1,
        actorType: 'ADMIN',
        actorId: 'admin-1',
        previousWelcomeBonus: null,
        previousDefaultBorrowingLimit: null,
        previousPlatformFee: null,
        newWelcomeBonus: '1.00',
        newDefaultBorrowingLimit: '1.00',
        newPlatformFee: '0.30',
        createdAt: NOW,
      }),
      expect.objectContaining({
        configVersion: 2,
        actorType: 'ADMIN',
        actorId: 'admin-1',
        previousWelcomeBonus: '1.00',
        previousDefaultBorrowingLimit: '1.00',
        previousPlatformFee: '0.30',
        newWelcomeBonus: '2.00',
        newDefaultBorrowingLimit: '0.00',
        newPlatformFee: '0.50',
        createdAt: NOW,
      }),
    ]);
  });

  it('does not create a version when the active values are unchanged', async () => {
    const ctx = context();
    await ctx.service.replace(ADMIN, config('1.00', '1.00', '0.30'), NOW);

    const repeat = await ctx.service.replace(ADMIN, {
      ...config('1.00', '1.00', '0.30'),
      configVersion: 99,
      currency: 'USD',
    }, NOW);

    expect(repeat.configVersion).toBe(1);
    expect(ctx.configs).toHaveLength(1);
    expect(ctx.audits).toHaveLength(1);
  });

  it('rejects an invalid configuration without changing the active row', async () => {
    const ctx = context();
    await ctx.service.replace(ADMIN, config('1.00', '1.00', '0.30'), NOW);

    await expect(ctx.service.replace(ADMIN, config('-1.00', '1.00', '0.30'), NOW)).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctx.service.replace(ADMIN, { ...config('1.00', '1.00', '0.30'), currency: 'ZWG' }, NOW))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(ctx.service.replace(ADMIN, {}, NOW)).rejects.toBeInstanceOf(BadRequestException);

    expect(ctx.configs).toEqual([
      expect.objectContaining({ configVersion: 1, isActive: true, welcomeBonus: '1.00', platformFee: '0.30' }),
    ]);
    expect(ctx.audits).toHaveLength(1);
  });
});

function config(welcomeBonus: string, defaultBorrowingLimit: string, platformFee: string) {
  return { welcomeBonus, defaultBorrowingLimit, platformFee };
}

function context() {
  const configs: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  let nextId = 1;
  const db = {
    walletConfig: {
      async findFirst({ where }: { where: { isActive: boolean } }) {
        return configs.find((row) => row.isActive === where.isActive) ?? null;
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        if ('welcomeBonus' in data || 'defaultBorrowingLimit' in data || 'platformFee' in data) {
          throw new Error('historical wallet configuration was edited');
        }
        const row = configs.find((item) => item.id === where.id);
        if (!row) throw new Error('missing wallet configuration');
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
    walletConfigAudit: {
      async create({ data }: { data: Record<string, unknown> }) {
        audits.push(data);
        return data;
      },
      async update() {
        throw new Error('wallet configuration audit was changed');
      },
    },
    async $queryRaw() {
      return [];
    },
    async $transaction<T>(callback: (tx: object) => Promise<T>) {
      return callback(db);
    },
  };
  return {
    service: new WalletConfigService(db as unknown as PrismaService),
    configs,
    audits,
  };
}
