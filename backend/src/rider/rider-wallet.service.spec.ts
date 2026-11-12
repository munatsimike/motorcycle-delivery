import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { WalletEntryType } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { WalletService } from './wallet.service.js';
import { formatSignedCents, signedCentsFromDecimal } from './wallet-money.js';

const PROFILE = 'profile-1';

describe('rider wallet reads', () => {
  it('returns the authenticated wallet summary with default capacity', async () => {
    const ctx = context();
    ctx.reservations.push(
      { riderWalletId: 'wallet-1', amount: '0.30', status: 'OPEN' },
      { riderWalletId: 'wallet-1', amount: '9.00', status: 'RELEASED' },
    );

    await expect(ctx.service.summary(PROFILE)).resolves.toEqual({
      riderProfileId: PROFILE,
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
    expect(ctx.writes).toBe(0);
    expect(ctx.wallets[0]?.welcomeBonusAwardedAt).toBeNull();
  });

  it('keeps a negative balance and floors capacity at zero', async () => {
    const ctx = context();
    ctx.wallets[0]!.balance = '-0.60';
    ctx.entries.push(entry({ amount: '-0.60', balanceAfter: '-0.60' }));

    await expect(ctx.service.summary(PROFILE)).resolves.toMatchObject({
      balance: '-0.60',
      borrowingLimit: '1.00',
      borrowingLimitSource: 'DEFAULT',
      reservedFees: '0.00',
      availableCapacity: '0.40',
    });

    ctx.wallets[0]!.borrowingLimitOverride = '0.00';
    await expect(ctx.service.summary(PROFILE)).resolves.toMatchObject({
      balance: '-0.60',
      borrowingLimit: '0.00',
      borrowingLimitSource: 'OVERRIDE',
      availableCapacity: '0.00',
    });

    ctx.wallets[0]!.balance = '-2.00';
    ctx.wallets[0]!.borrowingLimitOverride = '1.00';
    ctx.entries[0]!.amount = '-2.00';
    ctx.entries[0]!.balanceAfter = '-2.00';
    await expect(ctx.service.summary(PROFILE)).resolves.toMatchObject({
      balance: '-2.00',
      borrowingLimit: '1.00',
      borrowingLimitSource: 'OVERRIDE',
      availableCapacity: '0.00',
    });
    expect(ctx.writes).toBe(0);
  });

  it('returns newest transactions first and pages within the bound', async () => {
    const ctx = context();
    const older = new Date('2026-10-14T09:00:00.000Z');
    const same = new Date('2026-10-14T10:00:00.000Z');
    const newer = new Date('2026-10-14T11:00:00.000Z');
    ctx.entries.push(
      entry({
        id: '018f0000-0000-7000-8000-000000000001',
        createdAt: older,
        entryType: WalletEntryType.WELCOME_BONUS,
        amount: '1.00',
        balanceAfter: '1.00',
        reason: 'secret-admin-note',
      }),
      entry({
        id: '018f0000-0000-7000-8000-000000000003',
        createdAt: same,
        entryType: WalletEntryType.ADJUSTMENT,
        amount: '-0.60',
        balanceAfter: '0.40',
        reason: 'Balance correction',
      }),
      entry({
        id: '018f0000-0000-7000-8000-000000000002',
        createdAt: same,
        entryType: WalletEntryType.PROMOTIONAL_CREDIT,
        amount: '0.50',
        balanceAfter: '0.90',
        reason: 'Launch week',
      }),
      entry({
        id: '018f0000-0000-7000-8000-000000000004',
        riderWalletId: 'wallet-2',
        createdAt: newer,
        amount: '9.00',
        balanceAfter: '9.00',
      }),
      entry({
        id: '018f0000-0000-7000-8000-000000000005',
        createdAt: newer,
        entryType: WalletEntryType.TOP_UP,
        amount: '2.00',
        balanceAfter: '2.90',
        reason: 'secret-admin-note',
        idempotencyKey: 'secret-idempotency-key',
        payloadHash: 'secret-payload-hash',
        actorId: 'secret-admin-actor',
        payment: {
          method: 'ECOCASH',
          internalReceiptId: null,
          externalReceiptNumber: null,
          ecocashReference: 'MP2501.1234',
          provider: 'secret-provider',
          providerTransactionId: 'secret-provider-txn',
          idempotencyKey: 'secret-payment-key',
          payloadHash: 'secret-payment-hash',
          confirmedById: 'secret-confirmed-by',
        },
      }),
    );
    ctx.wallets[0]!.balance = '2.90';

    const first = await ctx.service.transactions(PROFILE, { limit: '2', riderProfileId: 'profile-2' });
    expect(first.transactions.map((row) => row.id)).toEqual([
      '018f0000-0000-7000-8000-000000000005',
      '018f0000-0000-7000-8000-000000000003',
    ]);
    expect(first.transactions[0]).toMatchObject({
      type: WalletEntryType.TOP_UP,
      amount: '2.00',
      balanceAfter: '2.90',
      currency: 'USD',
      createdAt: newer,
      reason: null,
      payment: {
        method: 'ECOCASH',
        internalReceiptId: null,
        externalReceiptNumber: null,
        ecocashReference: 'MP2501.1234',
      },
    });
    expect(first.transactions[1]).toMatchObject({
      type: WalletEntryType.ADJUSTMENT,
      amount: '-0.60',
      balanceAfter: '0.40',
      reason: 'Balance correction',
      payment: null,
    });
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await ctx.service.transactions(PROFILE, { limit: '2', cursor: first.nextCursor });
    expect(second.transactions.map((row) => row.id)).toEqual([
      '018f0000-0000-7000-8000-000000000002',
      '018f0000-0000-7000-8000-000000000001',
    ]);
    expect(second.transactions[0]?.reason).toBe('Launch week');
    expect(second.nextCursor).toBeNull();

    const json = JSON.stringify({ first, second });
    expect(json).not.toContain('secret-');
    expect(json).not.toContain('payloadHash');
    expect(json).not.toContain('idempotencyKey');
    expect(json).not.toContain('provider');
    expect(ctx.writes).toBe(0);
  });

  it('defaults to a bounded page and rejects an invalid page', async () => {
    const ctx = context();
    for (let index = 0; index < 21; index += 1) {
      ctx.entries.push(entry({
        id: `018f0000-0000-7000-8000-${String(index).padStart(12, '0')}`,
        createdAt: new Date(Date.UTC(2026, 9, 14, 0, 0, index)),
        amount: '0.10',
        balanceAfter: '0.10',
      }));
    }
    ctx.wallets[0]!.balance = '2.10';

    const page = await ctx.service.transactions(PROFILE, {});
    expect(page.transactions).toHaveLength(20);
    expect(page.transactions[0]?.id).toBe('018f0000-0000-7000-8000-000000000020');
    expect(page.nextCursor).toEqual(expect.any(String));

    const rest = await ctx.service.transactions(PROFILE, { cursor: page.nextCursor });
    expect(rest.transactions.map((row) => row.id)).toEqual(['018f0000-0000-7000-8000-000000000000']);
    expect(rest.nextCursor).toBeNull();

    await expect(ctx.service.transactions(PROFILE, { limit: '51' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctx.service.transactions(PROFILE, { cursor: 'not-a-cursor' })).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.writes).toBe(0);
  });

  it('reports a missing wallet without creating one or awarding a bonus', async () => {
    const ctx = context();
    ctx.wallets.splice(0, ctx.wallets.length);

    await expect(ctx.service.summary(PROFILE)).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctx.service.transactions(PROFILE, {})).rejects.toBeInstanceOf(NotFoundException);
    expect(ctx.wallets).toHaveLength(0);
    expect(ctx.entries).toHaveLength(0);
    expect(ctx.writes).toBe(0);
  });

  it('rejects a drifted wallet without posting a correction', async () => {
    const ctx = context();
    ctx.wallets[0]!.balance = '5.00';

    await expect(ctx.service.summary(PROFILE)).rejects.toBeInstanceOf(ConflictException);
    await expect(ctx.service.transactions(PROFILE, { limit: '10' })).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.entries).toHaveLength(0);
    expect(ctx.wallets[0]?.balance).toBe('5.00');
    expect(ctx.writes).toBe(0);
  });
});

type StoredPayment = {
  method: 'CASH' | 'ECOCASH' | 'GATEWAY';
  internalReceiptId: string | null;
  externalReceiptNumber: string | null;
  ecocashReference: string | null;
  provider: string | null;
  providerTransactionId: string | null;
  idempotencyKey: string;
  payloadHash: string;
  confirmedById: string | null;
};

type StoredEntry = {
  id: string;
  riderWalletId: string;
  entryType: WalletEntryType;
  amount: string;
  balanceAfter: string;
  createdAt: Date;
  reason: string | null;
  payloadHash: string;
  idempotencyKey: string;
  actorId: string | null;
  payment: StoredPayment | null;
};

function entry(overrides: Partial<StoredEntry> = {}): StoredEntry {
  return {
    id: '018f0000-0000-7000-8000-000000000001',
    riderWalletId: 'wallet-1',
    entryType: WalletEntryType.WELCOME_BONUS,
    amount: '0.00',
    balanceAfter: '0.00',
    createdAt: new Date('2026-10-14T09:00:00.000Z'),
    reason: null,
    payloadHash: 'stored-payload-hash',
    idempotencyKey: 'stored-idempotency-key',
    actorId: 'stored-admin-actor',
    payment: null,
    ...overrides,
  };
}

function context() {
  const wallets: Array<Record<string, unknown>> = [{
    id: 'wallet-1',
    riderProfileId: PROFILE,
    balance: '0.00',
    borrowingLimitOverride: null,
    welcomeBonusAwardedAt: null,
    currency: 'USD',
  }, {
    id: 'wallet-2',
    riderProfileId: 'profile-2',
    balance: '9.00',
    borrowingLimitOverride: null,
    welcomeBonusAwardedAt: null,
    currency: 'USD',
  }];
  const entries: StoredEntry[] = [];
  const reservations: Array<{ riderWalletId: string; amount: string; status: string }> = [];
  let writes = 0;
  const refuseWrite = () => {
    writes += 1;
    throw new Error('wallet read changed stored data');
  };
  const db = {
    walletConfig: {
      async findFirst() {
        return { id: 'config-1', defaultBorrowingLimit: '1.00', isActive: true };
      },
    },
    riderWallet: {
      async findUnique({ where }: { where: { id?: string; riderProfileId?: string } }) {
        if (where.riderProfileId) {
          return wallets.find((wallet) => wallet.riderProfileId === where.riderProfileId) ?? null;
        }
        return wallets.find((wallet) => wallet.id === where.id) ?? null;
      },
      async create() {
        return refuseWrite();
      },
      async update() {
        return refuseWrite();
      },
    },
    riderWalletEntry: {
      async aggregate({ where }: { where: { riderWalletId: string } }) {
        const rows = entries.filter((row) => row.riderWalletId === where.riderWalletId);
        if (rows.length === 0) return { _sum: { amount: null } };
        const cents = rows.reduce((sum, row) => sum + signedCentsFromDecimal(row.amount), 0);
        return { _sum: { amount: formatSignedCents(cents) } };
      },
      async findMany(args: {
        where: {
          riderWalletId: string;
          OR?: Array<{
            createdAt?: { lt: Date };
            AND?: Array<{ createdAt?: Date; id?: { lt: string } }>;
          }>;
        };
        take: number;
        select: { payment?: { select: Record<string, boolean> } };
      }) {
        assertHistorySelect(args.select);
        const matched = entries.filter((row) => row.riderWalletId === args.where.riderWalletId && matchesCursor(row, args.where.OR));
        matched.sort((left, right) => {
          const time = right.createdAt.getTime() - left.createdAt.getTime();
          if (time !== 0) return time;
          return left.id < right.id ? 1 : left.id > right.id ? -1 : 0;
        });
        return matched.slice(0, args.take).map((row) => ({
          id: row.id,
          entryType: row.entryType,
          amount: row.amount,
          balanceAfter: row.balanceAfter,
          createdAt: row.createdAt,
          reason: row.reason,
          payment: row.payment
            ? {
                method: row.payment.method,
                internalReceiptId: row.payment.internalReceiptId,
                externalReceiptNumber: row.payment.externalReceiptNumber,
                ecocashReference: row.payment.ecocashReference,
              }
            : null,
        }));
      },
      async create() {
        return refuseWrite();
      },
      async update() {
        return refuseWrite();
      },
      async delete() {
        return refuseWrite();
      },
    },
    walletFeeReservation: {
      async findMany({ where }: { where: { riderWalletId: string; status: string } }) {
        return reservations.filter((row) => row.riderWalletId === where.riderWalletId && row.status === where.status);
      },
      async create() {
        return refuseWrite();
      },
    },
    async $transaction<T>(callback: (tx: object) => Promise<T>) {
      return callback(db);
    },
  };
  return {
    service: new WalletService(db as unknown as PrismaService),
    wallets,
    entries,
    reservations,
    get writes() {
      return writes;
    },
  };
}

function matchesCursor(
  row: StoredEntry,
  clauses: Array<{ createdAt?: { lt: Date }; AND?: Array<{ createdAt?: Date; id?: { lt: string } }> }> | undefined,
): boolean {
  if (!clauses) return true;
  return clauses.some((clause) => {
    if (clause.createdAt?.lt) return row.createdAt.getTime() < clause.createdAt.lt.getTime();
    const createdAt = clause.AND?.find((part) => part.createdAt)?.createdAt;
    const id = clause.AND?.find((part) => part.id)?.id?.lt;
    return createdAt !== undefined && id !== undefined && row.createdAt.getTime() === createdAt.getTime() && row.id < id;
  });
}

function assertHistorySelect(select: { payment?: { select: Record<string, boolean> } }): void {
  const entryKeys = new Set(['id', 'entryType', 'amount', 'balanceAfter', 'createdAt', 'reason', 'payment']);
  const paymentKeys = new Set(['method', 'internalReceiptId', 'externalReceiptNumber', 'ecocashReference']);
  for (const key of Object.keys(select)) {
    if (!entryKeys.has(key)) throw new Error(`selected sensitive entry field ${key}`);
  }
  for (const key of Object.keys(select.payment?.select ?? {})) {
    if (!paymentKeys.has(key)) throw new Error(`selected sensitive payment field ${key}`);
  }
}
