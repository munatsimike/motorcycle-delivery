import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { WalletActorType, WalletEntryType } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { WalletService } from './wallet.service.js';
import { formatSignedCents, signedCentsFromDecimal } from './wallet-money.js';

const ADMIN = { userId: 'admin-1' };
const NOW = new Date('2026-10-14T09:00:00.000Z');

describe('manual wallet top-ups', () => {
  it('records a verified cash payment and credits the wallet once', async () => {
    const ctx = context();
    const result = await ctx.service.topUp(ADMIN, 'profile-1', cash(), 'cash-1', NOW);

    expect(result).toMatchObject({
      riderProfileId: 'profile-1',
      method: 'CASH',
      amount: '2.00',
      currency: 'USD',
      externalReceiptNumber: 'R-100',
      ecocashReference: null,
      balance: '2.00',
      replayed: false,
    });
    expect(result.internalReceiptId).toMatch(/^CR[0-9A-F]{32}$/);
    expect(ctx.locks[0]).toBe('profile');
    expect(ctx.locks.indexOf('wallet')).toBeGreaterThan(0);
    expect(ctx.payments).toEqual([
      expect.objectContaining({
        method: 'CASH',
        status: 'VERIFIED',
        amount: '2.00',
        internalReceiptId: result.internalReceiptId,
        externalReceiptNumber: 'R-100',
        ecocashReference: null,
        provider: null,
        providerTransactionId: null,
        confirmedById: 'admin-1',
        verifiedAt: NOW,
      }),
    ]);
    expect(ctx.entries).toEqual([
      expect.objectContaining({
        entryType: WalletEntryType.TOP_UP,
        amount: '2.00',
        balanceAfter: '2.00',
        actorType: WalletActorType.ADMIN,
        actorId: 'admin-1',
        walletPaymentId: result.paymentId,
        idempotencyKey: 'cash-1',
      }),
    ]);
    expect(ctx.wallets[0]?.balance).toBe('2.00');
  });

  it('records an EcoCash reference and refuses a second use', async () => {
    const ctx = context();
    const result = await ctx.service.topUp(ADMIN, 'profile-1', ecocash(), 'eco-1', NOW);

    expect(result).toMatchObject({
      method: 'ECOCASH',
      ecocashReference: 'MP2501.1234',
      internalReceiptId: null,
      externalReceiptNumber: null,
      balance: '2.00',
      replayed: false,
    });
    expect(ctx.payments[0]).toMatchObject({
      method: 'ECOCASH',
      ecocashReference: 'MP2501.1234',
      provider: null,
      confirmedById: 'admin-1',
    });

    const duplicate = ctx.service.topUp(ADMIN, 'profile-2', ecocash({ amount: '9.00' }), 'eco-2', NOW);
    await expect(duplicate).rejects.toBeInstanceOf(ConflictException);
    await expect(duplicate).rejects.toMatchObject({ status: 409 });
    expect(ctx.payments).toHaveLength(1);
    expect(ctx.entries).toHaveLength(1);
    expect(ctx.wallets.find((wallet) => wallet.riderProfileId === 'profile-2')).toBeUndefined();
  });

  it('requires an EcoCash reference and confirmation before crediting', async () => {
    const ctx = context();
    await expect(ctx.service.topUp(ADMIN, 'profile-1', ecocash({ ecocashReference: ' ' }), 'eco-blank', NOW))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(ctx.service.topUp(ADMIN, 'profile-1', { ...ecocash(), paymentReceived: false }, 'eco-unconfirmed', NOW))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.payments).toHaveLength(0);
    expect(ctx.entries).toHaveLength(0);
  });

  it('replays an identical request and rejects a different payload for the same key', async () => {
    const ctx = context();
    const original = await ctx.service.topUp(ADMIN, 'profile-1', cash(), 'same-key', NOW);
    const replay = await ctx.service.topUp(ADMIN, 'profile-1', cash(), 'same-key', new Date('2026-10-15T00:00:00.000Z'));

    expect(replay).toMatchObject({
      paymentId: original.paymentId,
      entryId: original.entryId,
      internalReceiptId: original.internalReceiptId,
      balance: '2.00',
      replayed: true,
    });
    expect(ctx.payments).toHaveLength(1);
    expect(ctx.entries).toHaveLength(1);

    const mismatch = ctx.service.topUp(ADMIN, 'profile-1', cash({ amount: '3.00' }), 'same-key', NOW);
    await expect(mismatch).rejects.toMatchObject({ status: 409 });
    expect(ctx.wallets[0]?.balance).toBe('2.00');
    expect(ctx.entries).toHaveLength(1);
  });

  it('adds a top-up to a negative balance', async () => {
    const ctx = context();
    ctx.wallets[0]!.balance = '-0.60';
    ctx.entries.push({
      id: 'entry-debt',
      riderWalletId: 'wallet-1',
      amount: '-0.60',
      balanceAfter: '-0.60',
      idempotencyKey: 'debt',
      walletPaymentId: null,
    });

    const result = await ctx.service.topUp(ADMIN, 'profile-1', ecocash({ amount: '2.00' }), 'repay-1', NOW);

    expect(result.balance).toBe('1.40');
    expect(ctx.wallets[0]?.balance).toBe('1.40');
    expect(ledgerCents(ctx)).toBe(140);
  });

  it('rolls back the verified payment when the ledger posting fails', async () => {
    const ctx = context();
    ctx.wallets[0]!.balance = '5.00';

    await expect(ctx.service.topUp(ADMIN, 'profile-1', cash(), 'drift-1', NOW)).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.payments).toHaveLength(0);
    expect(ctx.entries).toHaveLength(0);
    expect(ctx.wallets[0]?.balance).toBe('5.00');
  });

  it('credits once when the same request arrives twice together', async () => {
    const ctx = context({ pauseFirstLock: true });
    const first = ctx.service.topUp(ADMIN, 'profile-1', ecocash(), 'race-1', NOW);
    await waitUntil(() => ctx.paused);
    const second = ctx.service.topUp(ADMIN, 'profile-1', ecocash(), 'race-1', NOW);
    await waitUntil(() => ctx.waiting > 0);
    ctx.releasePause();

    const [left, right] = await Promise.all([first, second]);
    const results = [left, right];
    expect(results.filter((result) => result.replayed)).toHaveLength(1);
    expect(new Set(results.map((result) => result.paymentId)).size).toBe(1);
    expect(ctx.payments).toHaveLength(1);
    expect(ctx.entries).toHaveLength(1);
    expect(ctx.wallets[0]?.balance).toBe('2.00');
  });
});

function cash(overrides: Record<string, unknown> = {}) {
  return { amount: '2.00', method: 'CASH', paymentReceived: true, externalReceiptNumber: 'R-100', ...overrides };
}

function ecocash(overrides: Record<string, unknown> = {}) {
  return { amount: '2.00', method: 'ECOCASH', paymentReceived: true, ecocashReference: 'MP2501.1234', ...overrides };
}

function ledgerCents(ctx: ReturnType<typeof context>): number {
  return ctx.entries.reduce((sum, entry) => sum + signedCentsFromDecimal(String(entry.amount)), 0);
}

function context(options: { pauseFirstLock?: boolean } = {}) {
  const profiles = [{ id: 'profile-1' }, { id: 'profile-2' }];
  const configs = [{ id: 'config-1', configVersion: 1, isActive: true, defaultBorrowingLimit: '1.00', welcomeBonus: '1.00', platformFee: '0.30' }];
  const wallets: Array<Record<string, unknown>> = [{
    id: 'wallet-1',
    riderProfileId: 'profile-1',
    currency: 'USD',
    balance: '0.00',
    borrowingLimitOverride: null,
    welcomeBonusAwardedAt: null,
  }];
  const entries: Array<Record<string, unknown>> = [];
  const payments: Array<Record<string, unknown>> = [];
  const locks: string[] = [];
  const state = { pauseFirstLock: options.pauseFirstLock ?? false, paused: false, waiting: 0 };
  let releasePause: () => void = () => undefined;
  const pause = new Promise<void>((resolve) => {
    releasePause = resolve;
  });
  const holders = new Map<string, { txId: number; depth: number; wait: Promise<void>; resolve: () => void }>();
  let txSerial = 0;
  let nextPayment = 1;
  let nextEntry = 1;
  const acquire = async (id: string, txId: number) => {
    const current = holders.get(id);
    if (current?.txId === txId) {
      current.depth += 1;
      return () => {
        current.depth -= 1;
        if (current.depth === 0) {
          holders.delete(id);
          current.resolve();
        }
      };
    }
    while (holders.has(id)) {
      state.waiting += 1;
      await holders.get(id)?.wait;
      state.waiting -= 1;
    }
    let resolve: () => void = () => undefined;
    const wait = new Promise<void>((done) => {
      resolve = done;
    });
    const entry = { txId, depth: 1, wait, resolve };
    holders.set(id, entry);
    return () => {
      entry.depth -= 1;
      if (entry.depth === 0) {
        holders.delete(id);
        entry.resolve();
      }
    };
  };
  const db = {
    riderProfile: {
      async findUnique({ where }: { where: { id: string } }) {
        return profiles.find((profile) => profile.id === where.id) ?? null;
      },
    },
    walletConfig: {
      async findFirst({ where }: { where: { isActive: boolean } }) {
        return configs.find((row) => row.isActive === where.isActive) ?? null;
      },
    },
    riderWallet: {
      async findUnique({ where }: { where: { id?: string; riderProfileId?: string } }) {
        if (where.riderProfileId) return wallets.find((wallet) => wallet.riderProfileId === where.riderProfileId) ?? null;
        return wallets.find((wallet) => wallet.id === where.id) ?? null;
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const row = { id: `wallet-${wallets.length + 1}`, borrowingLimitOverride: null, welcomeBonusAwardedAt: null, ...data };
        wallets.push(row);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        if (Object.keys(data).some((key) => key !== 'balance')) {
          throw new Error('top-up changed more than the balance');
        }
        const row = wallets.find((wallet) => wallet.id === where.id);
        if (!row) throw new Error('wallet missing');
        Object.assign(row, data);
        return row;
      },
    },
    riderWalletEntry: {
      async findUnique({ where }: { where: { idempotencyKey?: string; walletPaymentId?: string } }) {
        if (where.idempotencyKey) return entries.find((entry) => entry.idempotencyKey === where.idempotencyKey) ?? null;
        return entries.find((entry) => entry.walletPaymentId === where.walletPaymentId) ?? null;
      },
      async aggregate({ where }: { where: { riderWalletId: string } }) {
        const rows = entries.filter((entry) => entry.riderWalletId === where.riderWalletId);
        if (rows.length === 0) return { _sum: { amount: null } };
        const cents = rows.reduce((sum, entry) => sum + signedCentsFromDecimal(String(entry.amount)), 0);
        return { _sum: { amount: formatSignedCents(cents) } };
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const row = { id: `entry-${nextEntry}`, ...data };
        nextEntry += 1;
        entries.push(row);
        return row;
      },
      async update() {
        throw new Error('ledger entry was changed');
      },
    },
    walletPayment: {
      async findUnique({ where }: { where: { id?: string; idempotencyKey?: string; ecocashReference?: string; externalReceiptNumber?: string } }) {
        return payments.find((payment) => {
          if (where.id) return payment.id === where.id;
          if (where.idempotencyKey) return payment.idempotencyKey === where.idempotencyKey;
          if (where.ecocashReference) return payment.ecocashReference === where.ecocashReference;
          return payment.externalReceiptNumber === where.externalReceiptNumber;
        }) ?? null;
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const row = { id: `payment-${nextPayment}`, ...data };
        nextPayment += 1;
        payments.push(row);
        return row;
      },
    },
    async $queryRaw(strings: TemplateStringsArray, values: unknown[] = [], txId = 0) {
      const sql = strings.join(' ');
      if (sql.includes('rider_profiles') && sql.includes('FOR UPDATE')) {
        const release = await acquire(String(values[0]), txId);
        locks.push('profile');
        if (state.pauseFirstLock && !state.paused) {
          state.paused = true;
          await pause;
        }
        return release;
      }
      if (sql.includes('rider_wallets') && sql.includes('FOR UPDATE')) locks.push('wallet');
      return undefined;
    },
    async $transaction<T>(callback: (tx: object) => Promise<T>) {
      const txId = ++txSerial;
      const releases: Array<() => void> = [];
      const snapshot = {
        wallets: structuredClone(wallets),
        entries: structuredClone(entries),
        payments: structuredClone(payments),
      };
      const tx = {
        ...db,
        async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
          const release = await db.$queryRaw(strings, values, txId);
          if (typeof release === 'function') releases.push(release);
          return [];
        },
      };
      try {
        return await callback(tx);
      } catch (error) {
        wallets.splice(0, wallets.length, ...snapshot.wallets);
        entries.splice(0, entries.length, ...snapshot.entries);
        payments.splice(0, payments.length, ...snapshot.payments);
        throw error;
      } finally {
        for (const release of releases) release();
      }
    },
  };
  return {
    service: new WalletService(db as unknown as PrismaService),
    wallets,
    entries,
    payments,
    locks,
    get paused() {
      return state.paused;
    },
    get waiting() {
      return state.waiting;
    },
    releasePause,
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 1000) throw new Error('timed out waiting for the rider lock');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
