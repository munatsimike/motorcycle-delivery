import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, WalletActorType, WalletEntryType, WalletPaymentStatus } from '../generated/prisma/client.js';
import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { walletPayloadHash, type CreditCommand, type LedgerCommand } from './wallet-ledger.js';
import { WalletService } from './wallet.service.js';
import { formatSignedCents, signedCentsFromDecimal } from './wallet-money.js';

const ADMIN = { userId: 'admin-1' };
const NOW = new Date('2026-10-14T09:00:00.000Z');

describe('WalletService', () => {
  it('creates one wallet for a rider and returns the same wallet again', async () => {
    const ctx = context();
    const created = await ctx.service.ensureWallet('profile-1', NOW);
    const again = await ctx.service.ensureWallet('profile-1', NOW);

    expect(created).toMatchObject({
      id: 'wallet-1',
      riderProfileId: 'profile-1',
      balance: '0.00',
      currency: 'USD',
      borrowingLimitOverride: null,
      welcomeBonusAwardedAt: null,
    });
    expect(again.id).toBe(created.id);
    expect(ctx.wallets).toHaveLength(1);
    expect(ctx.locks).toEqual(['profile', 'wallet', 'profile', 'wallet']);
  });

  it('returns the wallet created by the winning transaction after a unique race', async () => {
    const ctx = context({ loseCreateRace: true });
    const wallet = await ctx.service.ensureWallet('profile-1', NOW);

    expect(wallet.id).toBe('wallet-raced');
    expect(ctx.wallets).toHaveLength(1);
    expect(ctx.creates).toBe(1);
  });

  it('serializes credits on the rider lock and keeps the balance equal to the ledger', async () => {
    const ctx = context({ pauseFirstLock: true });
    const first = ctx.service.credit(credit({ amountCents: 100, idempotencyKey: 'credit-a' }));
    await waitUntil(() => ctx.paused);
    const second = ctx.service.credit(credit({ amountCents: 250, idempotencyKey: 'credit-b', reason: 'Second' }));
    await waitUntil(() => ctx.waiting > 0);
    ctx.releasePause();

    const [postedFirst, postedSecond] = await Promise.all([first, second]);
    expect(postedFirst).toMatchObject({ amount: '1.00', balance: '1.00', replayed: false, configVersion: 1 });
    expect(postedSecond).toMatchObject({ amount: '2.50', balance: '3.50', replayed: false });
    expect(ctx.wallets).toHaveLength(1);
    expect(ctx.entries).toHaveLength(0);
    expect(ctx.promotionalEntries).toHaveLength(2);
    expect(ctx.locks).toEqual(['profile', 'wallet', 'profile', 'wallet']);
    expect(balanceCents(ctx)).toBe(0);
    expect(promoCents(ctx)).toBe(350);
  });

  it('adds a top-up to a negative balance and floors capacity after a lower borrowing limit', async () => {
    const ctx = context();
    await ctx.service.post(command({
      entryType: WalletEntryType.ADJUSTMENT,
      amountCents: -60,
      idempotencyKey: 'adjust-1',
      reason: 'Correction',
    }));
    expect(ctx.wallets[0]?.balance).toBe('-0.60');

    const reduced = await ctx.service.setBorrowingLimit(ADMIN, 'profile-1', { borrowingLimit: '0.00' }, NOW);
    expect(reduced).toMatchObject({
      balance: '-0.60',
      borrowingLimit: '0.00',
      borrowingLimitSource: 'OVERRIDE',
      reservedFees: '0.00',
      availableCapacity: '0.00',
    });
    expect(ctx.wallets[0]?.balance).toBe('-0.60');
    expect(ctx.entries).toHaveLength(1);
    expect(ctx.limitAudits).toEqual([
      expect.objectContaining({
        actorId: 'admin-1',
        previousOverride: null,
        newOverride: '0.00',
        createdAt: NOW,
      }),
    ]);

    await expect(ctx.service.post(command({
      entryType: WalletEntryType.ADJUSTMENT,
      amountCents: -1,
      idempotencyKey: 'adjust-2',
      reason: 'Too far',
    }))).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.entries).toHaveLength(1);

    seedPayment(ctx, '2.00');
    const toppedUp = await ctx.service.credit(credit({
      entryType: WalletEntryType.TOP_UP,
      amountCents: 200,
      idempotencyKey: 'top-up-1',
      reason: null,
      walletPaymentId: 'payment-1',
    }));
    expect(toppedUp).toMatchObject({ amount: '2.00', balance: '1.40', entryType: WalletEntryType.TOP_UP });
    expect(balanceCents(ctx)).toBe(140);
    expect(ledgerCents(ctx)).toBe(140);

    const debt = context();
    await debt.service.ensureWallet('profile-1', NOW);
    await debt.service.setBorrowingLimit(ADMIN, 'profile-1', { borrowingLimit: '500.00' }, NOW);
    await debt.service.post(command({
      entryType: WalletEntryType.ADJUSTMENT,
      amountCents: -20_000,
      idempotencyKey: 'debt-200',
      reason: 'Opening debt',
    }));
    debt.payments.push(
      { id: 'payment-100', riderWalletId: 'wallet-1', amount: '100.00', currency: 'USD', status: WalletPaymentStatus.VERIFIED },
      { id: 'payment-150', riderWalletId: 'wallet-1', amount: '150.00', currency: 'USD', status: WalletPaymentStatus.VERIFIED },
    );
    await debt.service.credit(credit({
      entryType: WalletEntryType.TOP_UP,
      amountCents: 10_000,
      idempotencyKey: 'top-100',
      reason: null,
      walletPaymentId: 'payment-100',
    }));
    expect(debt.wallets[0]?.balance).toBe('-100.00');
    await debt.service.credit(credit({
      entryType: WalletEntryType.TOP_UP,
      amountCents: 15_000,
      idempotencyKey: 'top-150',
      reason: null,
      walletPaymentId: 'payment-150',
    }));
    expect(debt.wallets[0]?.balance).toBe('50.00');
    expect(debt.wallets[0]?.promotionalBalance ?? '0.00').toBe('0.00');
    await expect(ctx.service.summary('profile-1')).resolves.toMatchObject({
      balance: '1.40',
      borrowingLimit: '0.00',
      availableCapacity: '1.40',
    });
  });

  it('rejects a debit past the borrowing limit and a failed or mismatched payment', async () => {
    const ctx = context();
    await ctx.service.post(command({
      entryType: WalletEntryType.ADJUSTMENT,
      amountCents: -100,
      idempotencyKey: 'adjust-limit',
      reason: 'At the limit',
    }));
    await expect(ctx.service.post(command({
      entryType: WalletEntryType.ADJUSTMENT,
      amountCents: -1,
      idempotencyKey: 'adjust-over',
      reason: 'Past the limit',
    }))).rejects.toBeInstanceOf(ConflictException);

    seedPayment(ctx, '2.00', WalletPaymentStatus.FAILED);
    await expect(ctx.service.credit(credit({
      entryType: WalletEntryType.TOP_UP,
      amountCents: 200,
      idempotencyKey: 'failed-payment',
      reason: null,
      walletPaymentId: 'payment-1',
    }))).rejects.toBeInstanceOf(ConflictException);

    ctx.payments[0]!.status = WalletPaymentStatus.VERIFIED;
    ctx.payments[0]!.amount = '1.00';
    await expect(ctx.service.credit(credit({
      entryType: WalletEntryType.TOP_UP,
      amountCents: 200,
      idempotencyKey: 'mismatched-payment',
      reason: null,
      walletPaymentId: 'payment-1',
    }))).rejects.toBeInstanceOf(ConflictException);
    expect(ledgerCents(ctx)).toBe(-100);
    expect(balanceCents(ctx)).toBe(-100);
  });

  it('replays an identical idempotency key and rejects a different payload with 409', async () => {
    const ctx = context();
    const original = await ctx.service.credit(credit({ amountCents: 100, idempotencyKey: 'same-key' }));
    await ctx.service.credit(credit({ amountCents: 50, idempotencyKey: 'other-key', reason: 'Extra' }));

    const replay = await ctx.service.credit(credit({ amountCents: 100, idempotencyKey: 'same-key', now: new Date('2026-10-15T00:00:00.000Z') }));
    expect(replay).toMatchObject({ entryId: original.entryId, amount: '1.00', balance: '1.00', replayed: true, configVersion: 1 });
    expect(ctx.wallets[0]?.balance).toBe('0.00');
    expect(ctx.wallets[0]?.promotionalBalance).toBe('1.50');

    const mismatch = ctx.service.credit(credit({ amountCents: 300, idempotencyKey: 'same-key' }));
    await expect(mismatch).rejects.toBeInstanceOf(ConflictException);
    await expect(mismatch).rejects.toMatchObject({ status: 409 });
    expect(ctx.promotionalEntries).toHaveLength(2);
    expect(ctx.entries).toHaveLength(0);
    expect(promoCents(ctx)).toBe(150);
    expect(balanceCents(ctx)).toBe(0);

    await expect(ctx.service.credit(credit({
      riderProfileId: 'profile-2',
      amountCents: 100,
      idempotencyKey: 'same-key',
    }))).rejects.toMatchObject({ status: 409 });
    expect(ctx.wallets.map((wallet) => wallet.riderProfileId)).toEqual(['profile-1']);
  });

  it('leaves a posted amount in place when configuration changes and refuses fee posting', async () => {
    const ctx = context();
    const posted = await ctx.service.credit(credit({ amountCents: 100, idempotencyKey: 'bonus' }));
    ctx.configs[0]!.isActive = false;
    ctx.configs.push({
      id: 'config-2',
      configVersion: 2,
      welcomeBonus: '0.00',
      defaultBorrowingLimit: '5.00',
      platformFee: '0.10',
      isActive: true,
    });

    const replay = await ctx.service.credit(credit({ amountCents: 100, idempotencyKey: 'bonus' }));
    expect(replay).toMatchObject({ configVersion: 1, amount: '1.00', replayed: true });
    expect(posted.configVersion).toBe(1);

    await expect(ctx.service.post(command({
      entryType: WalletEntryType.PLATFORM_FEE,
      amountCents: -30,
      idempotencyKey: 'fee-1',
      reason: null,
    }))).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.promotionalEntries).toHaveLength(1);
    expect(ctx.entries).toHaveLength(0);
    expect(balanceCents(ctx)).toBe(0);
    expect(promoCents(ctx)).toBe(100);
  });

  it('reports default capacity without writing and rejects a drifted balance', async () => {
    const ctx = context();
    await ctx.service.ensureWallet('profile-1', NOW);
    ctx.reservations.push({ riderWalletId: 'wallet-1', amount: '0.30', status: 'OPEN' });

    await expect(ctx.service.summary('profile-1')).resolves.toEqual({
      riderProfileId: 'profile-1',
      balance: '0.00',
      borrowingLimit: '1.00',
      borrowingLimitSource: 'DEFAULT',
      reservedFees: '0.30',
      availableCapacity: '0.70',
      promotionalBalance: '0.00',
      availablePromotionalCredit: '0.00',
      newDeliveriesRestricted: false,
      currency: 'USD',
    });
    expect(ctx.updates).toEqual([]);

    ctx.wallets[0]!.balance = '5.00';
    await expect(ctx.service.summary('profile-1')).rejects.toBeInstanceOf(ConflictException);
    await expect(ctx.service.credit(credit({ amountCents: 100, idempotencyKey: 'drift' }))).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.entries).toHaveLength(0);
    expect(ctx.wallets[0]?.balance).toBe('5.00');
  });

  it('changes only the negative wallet limit and leaves the balance and reservations in place', async () => {
    const ctx = context();
    await ctx.service.ensureWallet('profile-1', NOW);
    const reservation = { riderWalletId: 'wallet-1', deliveryId: 'delivery-1', amount: '0.30', status: 'OPEN' };
    ctx.reservations.push(reservation);

    await expect(ctx.service.summary('profile-1')).resolves.toMatchObject({
      balance: '0.00',
      borrowingLimit: '1.00',
      borrowingLimitSource: 'DEFAULT',
      reservedFees: '0.30',
      availableCapacity: '0.70',
    });

    const custom = await ctx.service.setBorrowingLimit(ADMIN, 'profile-1', { borrowingLimit: '2.50' }, NOW);
    expect(custom).toMatchObject({
      balance: '0.00',
      borrowingLimit: '2.50',
      borrowingLimitSource: 'OVERRIDE',
      reservedFees: '0.30',
      availableCapacity: '2.20',
    });

    const blocked = await ctx.service.setBorrowingLimit(ADMIN, 'profile-1', { borrowingLimit: '0.00' }, NOW);
    expect(blocked).toMatchObject({
      balance: '0.00',
      borrowingLimit: '0.00',
      borrowingLimitSource: 'OVERRIDE',
      reservedFees: '0.30',
      availableCapacity: '0.00',
    });

    const restored = await ctx.service.setBorrowingLimit(ADMIN, 'profile-1', { borrowingLimit: null }, NOW);
    expect(restored).toMatchObject({
      balance: '0.00',
      borrowingLimit: '1.00',
      borrowingLimitSource: 'DEFAULT',
      reservedFees: '0.30',
      availableCapacity: '0.70',
    });

    expect(ctx.wallets[0]?.balance).toBe('0.00');
    expect(ctx.wallets[0]?.borrowingLimitOverride).toBeNull();
    expect(ctx.entries).toEqual([]);
    expect(ctx.reservations).toEqual([reservation]);
    expect(ctx.limitAudits.map((audit) => audit.newOverride)).toEqual(['2.50', '0.00', null]);
    expect(() => ctx.service.setBorrowingLimit(ADMIN, 'profile-1', { borrowingLimit: '-1.00' }, NOW)).toThrow(BadRequestException);
    expect(() => ctx.service.setBorrowingLimit(ADMIN, 'profile-1', { borrowingLimit: '1' }, NOW)).toThrow(BadRequestException);
    expect(() => ctx.service.setBorrowingLimit(ADMIN, 'profile-1', {}, NOW)).toThrow(BadRequestException);
    expect(ctx.entries).toEqual([]);
    expect(ctx.reservations).toEqual([reservation]);
    expect(ctx.wallets[0]?.balance).toBe('0.00');
  });

  it('rejects a missing rider, a blank idempotency key, and an unchanged borrowing limit', async () => {
    const ctx = context();
    await expect(ctx.service.ensureWallet('missing', NOW)).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctx.service.summary('profile-1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctx.service.credit(credit({ idempotencyKey: ' ' }))).rejects.toBeInstanceOf(BadRequestException);
    await ctx.service.ensureWallet('profile-1', NOW);
    const same = await ctx.service.setBorrowingLimit(ADMIN, 'profile-1', { borrowingLimit: null }, NOW);
    expect(same.borrowingLimitSource).toBe('DEFAULT');
    expect(ctx.limitAudits).toHaveLength(0);
    expect(ctx.wallets[0]?.balance).toBe('0.00');
  });

  it('binds the payload hash to the posted amount', () => {
    const payload = {
      riderProfileId: 'profile-1',
      entryType: WalletEntryType.PROMOTIONAL_CREDIT,
      amountCents: 100,
      idempotencyKey: 'credit-1',
      reason: 'Launch',
      walletPaymentId: null,
      actorType: WalletActorType.ADMIN,
      actorId: 'admin-1',
      now: NOW,
    };
    expect(walletPayloadHash(payload)).toBe(walletPayloadHash({ ...payload, now: new Date('2026-11-01T00:00:00.000Z') }));
    expect(walletPayloadHash(payload)).not.toBe(walletPayloadHash({ ...payload, amountCents: 101 }));
  });
});

function credit(overrides: Partial<CreditCommand> = {}): CreditCommand {
  const entryType = overrides.entryType ?? WalletEntryType.PROMOTIONAL_CREDIT;
  return {
    ...command({
      entryType,
      amountCents: 100,
      idempotencyKey: 'credit-1',
      reason: 'Launch',
      walletPaymentId: null,
      ...overrides,
    }),
    entryType,
  };
}

function command(overrides: Partial<LedgerCommand> = {}): LedgerCommand {
  return {
    riderProfileId: 'profile-1',
    entryType: WalletEntryType.PROMOTIONAL_CREDIT,
    amountCents: 100,
    idempotencyKey: 'credit-1',
    reason: 'Launch',
    walletPaymentId: null,
    actorType: WalletActorType.ADMIN,
    actorId: 'admin-1',
    now: NOW,
    ...overrides,
  };
}

function seedPayment(ctx: ReturnType<typeof context>, amount: string, status: WalletPaymentStatus = WalletPaymentStatus.VERIFIED) {
  ctx.payments.push({
    id: 'payment-1',
    riderWalletId: 'wallet-1',
    amount,
    currency: 'USD',
    status,
  });
}

function balanceCents(ctx: ReturnType<typeof context>): number {
  return signedCentsFromDecimal(String(ctx.wallets[0]?.balance));
}

function promoCents(ctx: ReturnType<typeof context>): number {
  return signedCentsFromDecimal(String(ctx.wallets[0]?.promotionalBalance ?? '0.00'));
}

function ledgerCents(ctx: ReturnType<typeof context>): number {
  return ctx.entries.reduce((sum, entry) => sum + signedCentsFromDecimal(String(entry.amount)), 0);
}

function context(options: { pauseFirstLock?: boolean; loseCreateRace?: boolean } = {}) {
  const profiles = [{ id: 'profile-1' }, { id: 'profile-2' }];
  const configs: Array<Record<string, unknown>> = [{
    id: 'config-1',
    configVersion: 1,
    welcomeBonus: '1.00',
    defaultBorrowingLimit: '1.00',
    platformFee: '0.30',
    isActive: true,
  }];
  const wallets: Array<Record<string, unknown>> = options.loseCreateRace
    ? [{
      id: 'wallet-raced',
      riderProfileId: 'profile-1',
      balance: '0.00',
      borrowingLimitOverride: null,
      welcomeBonusAwardedAt: null,
      currency: 'USD',
    }]
    : [];
  const entries: Array<Record<string, unknown>> = [];
  const promotionalEntries: Array<Record<string, unknown>> = [];
  const payments: Array<Record<string, unknown>> = [];
  const reservations: Array<Record<string, unknown>> = [];
  const limitAudits: Array<Record<string, unknown>> = [];
  const locks: string[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const state = { pauseFirstLock: options.pauseFirstLock ?? false, paused: false, waiting: 0 };
  let releasePause: () => void = () => undefined;
  const pause = new Promise<void>((resolve) => {
    releasePause = resolve;
  });
  const holders = new Map<string, Promise<void>>();
  const acquire = async (id: string) => {
    while (holders.has(id)) {
      state.waiting += 1;
      await holders.get(id);
      state.waiting -= 1;
    }
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    holders.set(id, gate);
    return () => {
      if (holders.get(id) === gate) holders.delete(id);
      release();
    };
  };
  let creates = 0;
  let ownerLookups = 0;
  let nextEntry = 1;

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
        if (where.riderProfileId) {
          ownerLookups += 1;
          if (options.loseCreateRace && ownerLookups === 1) return null;
          return wallets.find((wallet) => wallet.riderProfileId === where.riderProfileId) ?? null;
        }
        return wallets.find((wallet) => wallet.id === where.id) ?? null;
      },
      async create({ data }: { data: Record<string, unknown> }) {
        creates += 1;
        if (options.loseCreateRace) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: '7.1.0',
          });
        }
        const row = {
          id: `wallet-${wallets.length + 1}`,
          borrowingLimitOverride: null,
          welcomeBonusAwardedAt: null,
          ...data,
        };
        wallets.push(row);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const keys = Object.keys(data);
        if (keys.includes('balance') && keys.length !== 1) {
          throw new Error('ledger post changed more than the balance');
        }
        if (keys.includes('borrowingLimitOverride') && keys.length !== 1) {
          throw new Error('borrowing limit change rewrote the wallet');
        }
        const row = wallets.find((wallet) => wallet.id === where.id);
        if (!row) throw new Error('wallet missing');
        updates.push(data);
        Object.assign(row, data);
        return row;
      },
    },
    riderWalletEntry: {
      async findUnique({ where }: { where: { idempotencyKey?: string; walletPaymentId?: string } }) {
        if (where.idempotencyKey) {
          return entries.find((entry) => entry.idempotencyKey === where.idempotencyKey) ?? null;
        }
        if (where.walletPaymentId) {
          return entries.find((entry) => entry.walletPaymentId === where.walletPaymentId) ?? null;
        }
        return null;
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
      async delete() {
        throw new Error('ledger entry was changed');
      },
    },
    riderPromotionalEntry: {
      async findUnique({ where }: { where: { idempotencyKey?: string } }) {
        return promotionalEntries.find((entry) => entry.idempotencyKey === where.idempotencyKey) ?? null;
      },
      async aggregate({ where }: { where: { riderWalletId: string } }) {
        const rows = promotionalEntries.filter((entry) => entry.riderWalletId === where.riderWalletId);
        if (rows.length === 0) return { _sum: { amount: null } };
        const cents = rows.reduce((sum, entry) => sum + signedCentsFromDecimal(String(entry.amount)), 0);
        return { _sum: { amount: formatSignedCents(cents) } };
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const row = { id: `promo-${promotionalEntries.length + 1}`, ...data };
        promotionalEntries.push(row);
        return row;
      },
    },
    walletPayment: {
      async findUnique({ where }: { where: { id: string } }) {
        return payments.find((payment) => payment.id === where.id) ?? null;
      },
    },
    walletFeeReservation: {
      async findMany({ where }: { where: { riderWalletId: string; status: string } }) {
        return reservations.filter((row) => row.riderWalletId === where.riderWalletId && row.status === where.status);
      },
    },
    walletBorrowingLimitAudit: {
      async create({ data }: { data: Record<string, unknown> }) {
        limitAudits.push({ ...data });
        return data;
      },
      async update() {
        throw new Error('borrowing limit audit was changed');
      },
    },
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join(' ');
      if (sql.includes('rider_profiles') && sql.includes('FOR UPDATE')) {
        const release = await acquire(String(values[0]));
        locks.push('profile');
        if (state.pauseFirstLock && !state.paused) {
          state.paused = true;
          await pause;
        }
        return release;
      }
      if (sql.includes('rider_wallets') && sql.includes('FOR UPDATE')) {
        locks.push('wallet');
      }
      return undefined;
    },
    async $transaction<T>(callback: (tx: object) => Promise<T>) {
      const snapshot = {
        wallets: structuredClone(wallets),
        entries: structuredClone(entries),
        promotionalEntries: structuredClone(promotionalEntries),
        limitAudits: structuredClone(limitAudits),
        updates: structuredClone(updates),
      };
      const releases: Array<() => void> = [];
      const tx = {
        ...db,
        async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
          const release = await db.$queryRaw(strings, ...values);
          if (typeof release === 'function') releases.push(release);
          return [];
        },
      };
      try {
        return await callback(tx);
      } catch (error) {
        wallets.splice(0, wallets.length, ...snapshot.wallets);
        entries.splice(0, entries.length, ...snapshot.entries);
        promotionalEntries.splice(0, promotionalEntries.length, ...snapshot.promotionalEntries);
        limitAudits.splice(0, limitAudits.length, ...snapshot.limitAudits);
        updates.splice(0, updates.length, ...snapshot.updates);
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
    promotionalEntries,
    payments,
    reservations,
    configs,
    limitAudits,
    locks,
    updates,
    get creates() {
      return creates;
    },
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
    if (Date.now() - started > 1000) throw new Error('timed out waiting for the wallet lock');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
