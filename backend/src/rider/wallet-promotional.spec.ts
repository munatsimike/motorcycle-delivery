import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { WalletActorType, WalletEntryType } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import {
  newDeliveriesRestricted,
  reservationPortions,
  splitCommission,
} from './promotional-credit.js';
import {
  awardWelcomeBonus,
  capturePlatformFeeReservation,
  creditWallet,
  openPlatformFeeReservation,
  readWalletSummary,
  refundAcceptanceCommission,
  releasePlatformFeeReservation,
} from './wallet-ledger.js';

const NOW = new Date('2026-10-29T12:00:00.000Z');
const ADMIN = { userId: 'admin-1' };

describe('promotional credit capacity', () => {
  it('covers a fee from promotional credit before the signed wallet', () => {
    expect(splitCommission(300, 100, 200, 'short')).toEqual({ total: 300, promo: 100, wallet: 200 });
    expect(splitCommission(300, 300, 0, 'short')).toEqual({ total: 300, promo: 300, wallet: 0 });
    expect(splitCommission(200, 0, 200, 'short')).toEqual({ total: 200, promo: 0, wallet: 200 });
  });

  it('rejects a cash portion that exceeds main-wallet capacity', () => {
    expect(() => splitCommission(300, 100, 199, 'short')).toThrow(ConflictException);
    expect(() => splitCommission(200, 0, 200, 'short')).not.toThrow();
    expect(() => splitCommission(300, 0, 200, 'short')).toThrow('short');
    expect(() => splitCommission(1, 0, 0, 'short')).toThrow('short');
    expect(splitCommission(100, 100, 0, 'short')).toEqual({ total: 100, promo: 100, wallet: 0 });
  });

  it('keeps an unset reservation split on the cash side', () => {
    expect(reservationPortions({ amount: '0.30' })).toEqual({ total: 30, promo: 0, wallet: 30 });
    expect(reservationPortions({ amount: '3.00', promotionalAmount: '1.00', walletAmount: '2.00' })).toEqual({
      total: 300,
      promo: 100,
      wallet: 200,
    });
  });

  it('restricts a v1 rider only when cover is below the configured fee', () => {
    expect(newDeliveriesRestricted({
      coverCents: 0,
      platformFeeCents: 30,
      marketplace: false,
      positivePublishedRate: false,
    })).toBe(true);
    expect(newDeliveriesRestricted({
      coverCents: 200,
      platformFeeCents: 30,
      marketplace: false,
      positivePublishedRate: false,
    })).toBe(false);
    expect(newDeliveriesRestricted({
      coverCents: 0,
      platformFeeCents: 0,
      marketplace: true,
      positivePublishedRate: true,
    })).toBe(true);
    expect(newDeliveriesRestricted({
      coverCents: 1,
      platformFeeCents: 30,
      marketplace: true,
      positivePublishedRate: true,
    })).toBe(false);
  });
});

describe('acceptance commission refunds', () => {
  it('restores a fully promotional commission without a cash debit', async () => {
    const ctx = await capturedFee({ promoCents: 250, cashCents: 0 });
    expect(ctx.cash.filter((entry) => entry.entryType === 'PLATFORM_FEE')).toHaveLength(0);
    expect(ctx.wallets[0]).toMatchObject({ balance: '0.00', promotionalBalance: '0.00' });

    await ctx.tx((tx) => refundAcceptanceCommission(tx, 'assignment-1', NOW));
    await ctx.tx((tx) => refundAcceptanceCommission(tx, 'assignment-1', NOW));

    expect(ctx.wallets[0]).toMatchObject({ balance: '0.00', promotionalBalance: '2.50' });
    expect(ctx.cash.filter((entry) => entry.entryType === 'PLATFORM_FEE_REFUND')).toHaveLength(0);
    expect(ctx.promo.filter((entry) => entry.entryType === 'ISSUED' && entry.reason === 'Platform fee restored')).toHaveLength(1);
  });

  it('refunds a fully cash commission back to the signed wallet', async () => {
    const ctx = await capturedFee({ promoCents: 0, cashCents: 250 });
    expect(ctx.wallets[0]?.balance).toBe('0.00');

    await ctx.tx((tx) => refundAcceptanceCommission(tx, 'assignment-1', NOW));
    await ctx.tx((tx) => refundAcceptanceCommission(tx, 'assignment-1', NOW));

    expect(ctx.wallets[0]).toMatchObject({ balance: '2.50', promotionalBalance: '0.00' });
    expect(ctx.cash.filter((entry) => entry.entryType === 'PLATFORM_FEE_REFUND')).toHaveLength(1);
    expect(ctx.promo.filter((entry) => entry.reason === 'Platform fee restored')).toHaveLength(0);
  });

  it('refunds a mixed commission to both balances once', async () => {
    const ctx = await capturedFee({ promoCents: 100, cashCents: 200 });
    expect(ctx.wallets[0]).toMatchObject({ balance: '0.50', promotionalBalance: '0.00' });

    await ctx.tx((tx) => refundAcceptanceCommission(tx, 'assignment-1', NOW));
    await ctx.tx((tx) => refundAcceptanceCommission(tx, 'assignment-1', NOW));

    expect(ctx.wallets[0]).toMatchObject({ balance: '2.00', promotionalBalance: '1.00' });
    expect(ctx.cash.filter((entry) => entry.entryType === 'PLATFORM_FEE_REFUND')).toHaveLength(1);
    expect(ctx.promo.filter((entry) => entry.reason === 'Platform fee restored')).toHaveLength(1);
  });

  it('releases an open reservation without refunding either balance', async () => {
    const ctx = ledger();
    ctx.wallets[0]!.promotionalBalance = '1.00';
    ctx.promo.push({
      id: 'promo-seed',
      riderWalletId: 'wallet-1',
      entryType: 'ISSUED',
      amount: '1.00',
      balanceAfter: '1.00',
      idempotencyKey: 'seed-promo',
      reservationId: null,
      reason: 'Launch',
    });
    await ctx.tx((tx) => openPlatformFeeReservation(tx, 'profile-1', 'delivery-1', NOW, 'assignment-1'));
    await ctx.tx((tx) => releasePlatformFeeReservation(tx, 'delivery-1', NOW));

    expect(ctx.reservations[0]?.status).toBe('RELEASED');
    expect(ctx.wallets[0]).toMatchObject({ balance: '2.00', promotionalBalance: '1.00' });
    expect(ctx.cash.filter((entry) => entry.entryType === 'PLATFORM_FEE' || entry.entryType === 'PLATFORM_FEE_REFUND')).toHaveLength(0);
    expect(ctx.promo.filter((entry) => entry.entryType === 'CONSUMED' || entry.reason === 'Platform fee restored')).toHaveLength(0);
    await expect(ctx.tx((tx) => refundAcceptanceCommission(tx, 'assignment-1', NOW))).rejects.toThrow('Acceptance commission charge is inconsistent');
    expect(ctx.wallets[0]).toMatchObject({ balance: '2.00', promotionalBalance: '1.00' });
  });
});

describe('promotional credit ledger', () => {
  it('issues a welcome bonus once into promotional credit and leaves the cash balance unchanged', async () => {
    const ctx = ledger();
    ctx.wallets[0]!.balance = '0.00';
    ctx.cash.splice(0, ctx.cash.length);
    await ctx.tx((tx) => awardWelcomeBonus(tx, 'profile-1', ADMIN, NOW));
    expect(ctx.wallets[0]).toMatchObject({ balance: '0.00', promotionalBalance: '1.00', welcomeBonusAwardedAt: NOW });
    expect(ctx.cash).toHaveLength(0);
    expect(ctx.promo).toHaveLength(1);

    await ctx.tx((tx) => awardWelcomeBonus(tx, 'profile-1', ADMIN, NOW));
    expect(ctx.promo).toHaveLength(1);
    expect(ctx.wallets[0]?.promotionalBalance).toBe('1.00');
  });

  it('does not award a second welcome bonus when the entitlement flag is already set', async () => {
    const ctx = ledger();
    ctx.wallets[0]!.welcomeBonusAwardedAt = new Date('2026-10-01T00:00:00.000Z');
    await ctx.tx((tx) => awardWelcomeBonus(tx, 'profile-1', ADMIN, NOW));
    expect(ctx.promo).toHaveLength(0);
    expect(ctx.cash).toHaveLength(1);
    expect(ctx.wallets[0]?.balance).toBe('2.00');
    expect(ctx.wallets[0]?.promotionalBalance).toBe('0.00');
  });

  it('consumes promotional credit before cash, releases the hold, and captures once', async () => {
    const ctx = ledger();
    await ctx.tx((tx) => creditWallet(tx, {
      riderProfileId: 'profile-1',
      entryType: WalletEntryType.PROMOTIONAL_CREDIT,
      amountCents: 100,
      idempotencyKey: 'launch',
      reason: 'Launch',
      walletPaymentId: null,
      actorType: WalletActorType.ADMIN,
      actorId: 'admin-1',
      now: NOW,
    }));
    await ctx.tx((tx) => creditWallet(tx, {
      riderProfileId: 'profile-1',
      entryType: WalletEntryType.PROMOTIONAL_CREDIT,
      amountCents: 100,
      idempotencyKey: 'launch',
      reason: 'Launch',
      walletPaymentId: null,
      actorType: WalletActorType.ADMIN,
      actorId: 'admin-1',
      now: NOW,
    }));
    expect(ctx.promo).toHaveLength(1);
    expect(ctx.wallets[0]?.balance).toBe('2.00');
    expect(ctx.wallets[0]?.promotionalBalance).toBe('1.00');

    await ctx.tx((tx) => openPlatformFeeReservation(tx, 'profile-1', 'delivery-1', NOW, 'assignment-1'));
    expect(ctx.reservations[0]).toMatchObject({ amount: '2.50', promotionalAmount: '1.00', walletAmount: '1.50', status: 'OPEN' });
    await ctx.tx((tx) => openPlatformFeeReservation(tx, 'profile-1', 'delivery-2', NOW, 'assignment-2'));
    expect(ctx.reservations[1]).toMatchObject({ promotionalAmount: '0.00', walletAmount: '2.50', status: 'OPEN' });
    const held = await ctx.tx((tx) => readWalletSummary(tx, 'profile-1'));
    expect(held).toMatchObject({
      balance: '2.00',
      promotionalBalance: '1.00',
      availablePromotionalCredit: '0.00',
      availableCapacity: '3.00',
      reservedFees: '5.00',
    });

    await ctx.tx((tx) => releasePlatformFeeReservation(tx, 'delivery-1', NOW));
    expect(ctx.reservations[0]?.status).toBe('RELEASED');
    expect(ctx.wallets[0]?.promotionalBalance).toBe('1.00');
    expect(ctx.promo).toHaveLength(1);
    const released = await ctx.tx((tx) => readWalletSummary(tx, 'profile-1'));
    expect(released.availablePromotionalCredit).toBe('1.00');

    ctx.reservations[0]!.status = 'OPEN';
    ctx.reservations[0]!.releasedAt = null;
    const first = await ctx.tx((tx) => capturePlatformFeeReservation(tx, 'delivery-1', 'profile-1', NOW, 'assignment-1'));
    const replay = await ctx.tx((tx) => capturePlatformFeeReservation(tx, 'delivery-1', 'profile-1', NOW, 'assignment-1'));
    expect(first).toMatchObject({ captured: true, replayed: false, amount: '-1.50', balance: '0.50' });
    expect(replay).toMatchObject({ captured: true, replayed: true, balance: '0.50' });
    expect(ctx.cash.filter((entry) => entry.entryType === 'PLATFORM_FEE')).toHaveLength(1);
    expect(ctx.promo.filter((entry) => entry.entryType === 'CONSUMED')).toHaveLength(1);
    expect(ctx.wallets[0]).toMatchObject({ balance: '0.50', promotionalBalance: '0.00' });
  });

  it('lets a rider at the borrowing limit finish an open reservation and blocks a new one', async () => {
    const ctx = ledger();
    ctx.wallets[0]!.balance = '-5.00';
    ctx.wallets[0]!.borrowingLimitOverride = '5.00';
    ctx.cash[0]!.amount = '-5.00';
    ctx.cash[0]!.balanceAfter = '-5.00';
    await expect(ctx.tx((tx) => openPlatformFeeReservation(tx, 'profile-1', 'delivery-2', NOW, 'assignment-2')))
      .rejects.toThrow('Wallet capacity is not enough for the platform fee');

    ctx.reservations.push({
      id: 'reservation-open',
      riderWalletId: 'wallet-1',
      deliveryId: 'delivery-1',
      assignmentId: 'assignment-1',
      amount: '2.50',
      promotionalAmount: '0.00',
      walletAmount: '2.50',
      currency: 'USD',
      configVersion: 1,
      status: 'OPEN',
      releasedAt: null,
      capturedAt: null,
    });
    const captured = await ctx.tx((tx) => capturePlatformFeeReservation(tx, 'delivery-1', 'profile-1', NOW, 'assignment-1'));
    expect(captured.amount).toBe('-2.50');
    expect(ctx.wallets[0]?.balance).toBe('-7.50');
  });
});

type Row = Record<string, any>;

async function capturedFee(split: { promoCents: number; cashCents: number }) {
  const ctx = ledger();
  const cash = (split.cashCents / 100).toFixed(2);
  ctx.wallets[0]!.balance = cash;
  ctx.wallets[0]!.promotionalBalance = (split.promoCents / 100).toFixed(2);
  ctx.cash.splice(0, ctx.cash.length);
  if (split.cashCents > 0) {
    ctx.cash.push({
      id: 'cash-1',
      riderWalletId: 'wallet-1',
      entryType: 'TOP_UP',
      amount: cash,
      balanceAfter: cash,
      idempotencyKey: 'opening-cash',
    });
  }
  if (split.promoCents > 0) {
    ctx.promo.push({
      id: 'promo-seed',
      riderWalletId: 'wallet-1',
      entryType: 'ISSUED',
      amount: (split.promoCents / 100).toFixed(2),
      balanceAfter: (split.promoCents / 100).toFixed(2),
      idempotencyKey: 'opening-promo',
      reservationId: null,
      reason: 'Launch',
    });
  }
  await ctx.tx((tx) => openPlatformFeeReservation(tx, 'profile-1', 'delivery-1', NOW, 'assignment-1'));
  await ctx.tx((tx) => capturePlatformFeeReservation(tx, 'delivery-1', 'profile-1', NOW, 'assignment-1'));
  return ctx;
}

function ledger() {
  const profiles = [{ id: 'profile-1' }];
  const wallets: Row[] = [{
    id: 'wallet-1',
    riderProfileId: 'profile-1',
    balance: '2.00',
    promotionalBalance: '0.00',
    borrowingLimitOverride: null,
    welcomeBonusAwardedAt: null,
    currency: 'USD',
  }];
  const cash: Row[] = [{
    id: 'cash-1',
    riderWalletId: 'wallet-1',
    entryType: 'TOP_UP',
    amount: '2.00',
    balanceAfter: '2.00',
    idempotencyKey: 'top-up',
    payloadHash: 'hash',
  }];
  const promo: Row[] = [];
  const reservations: Row[] = [];
  const configs = [{
    id: 'config-1',
    configVersion: 1,
    isActive: true,
    welcomeBonus: '1.00',
    defaultBorrowingLimit: '5.00',
    platformFee: '2.50',
  }];
  const assignments = [{
    id: 'assignment-1',
    deliveryId: 'delivery-1',
    riderProfileId: 'profile-1',
    status: 'ACCEPTED',
    acceptedPlatformFee: '2.50',
    acceptedFeeConfigVersion: 1,
    acceptedCommissionModel: 'ON_ACCEPTANCE',
  }];
  const db = {
    riderProfile: {
      async findUnique({ where }: { where: { id: string } }) {
        return profiles.find((profile) => profile.id === where.id) ?? null;
      },
    },
    walletConfig: {
      async findFirst() {
        return configs.find((config) => config.isActive) ?? null;
      },
    },
    riderWallet: {
      async findUnique({ where }: { where: { id?: string; riderProfileId?: string } }) {
        if (where.riderProfileId) return wallets.find((wallet) => wallet.riderProfileId === where.riderProfileId) ?? null;
        return wallets.find((wallet) => wallet.id === where.id) ?? null;
      },
      async update({ where, data }: { where: { id: string }; data: Row }) {
        const wallet = wallets.find((row) => row.id === where.id);
        if (!wallet) throw new Error('wallet missing');
        Object.assign(wallet, data);
        return wallet;
      },
      async create() {
        throw new Error('wallet already exists');
      },
    },
    riderWalletEntry: {
      async findUnique({ where }: { where: { idempotencyKey?: string } }) {
        return cash.find((entry) => entry.idempotencyKey === where.idempotencyKey) ?? null;
      },
      async aggregate({ where }: { where: { riderWalletId: string } }) {
        const rows = cash.filter((entry) => entry.riderWalletId === where.riderWalletId);
        const cents = rows.reduce((sum, entry) => sum + Number(String(entry.amount).replace('.', '')), 0);
        const negative = rows.some((entry) => String(entry.amount).startsWith('-'));
        const text = (Math.abs(cents) / 100).toFixed(2);
        return { _sum: { amount: rows.length === 0 ? null : `${negative && cents < 0 ? '-' : ''}${text}` } };
      },
      async create({ data }: { data: Row }) {
        const row = { id: `cash-${cash.length + 1}`, ...data };
        cash.push(row);
        return row;
      },
    },
    riderPromotionalEntry: {
      async findUnique({ where }: { where: { idempotencyKey?: string } }) {
        return promo.find((entry) => entry.idempotencyKey === where.idempotencyKey) ?? null;
      },
      async aggregate({ where }: { where: { riderWalletId: string } }) {
        const rows = promo.filter((entry) => entry.riderWalletId === where.riderWalletId);
        if (rows.length === 0) return { _sum: { amount: null } };
        const cents = rows.reduce((sum, entry) => sum + Math.round(Number(entry.amount) * 100), 0);
        return { _sum: { amount: (cents / 100).toFixed(2) } };
      },
      async create({ data }: { data: Row }) {
        const row = { id: `promo-${promo.length + 1}`, ...data };
        promo.push(row);
        return row;
      },
    },
    walletFeeReservation: {
      async findMany({ where }: { where: { riderWalletId?: string; deliveryId?: string; assignmentId?: string; status?: string } }) {
        return reservations.filter((row) => (
          (where.riderWalletId === undefined || row.riderWalletId === where.riderWalletId)
          && (where.deliveryId === undefined || row.deliveryId === where.deliveryId)
          && (where.assignmentId === undefined || row.assignmentId === where.assignmentId)
          && (where.status === undefined || row.status === where.status)
        ));
      },
      async findFirst({ where }: { where: { id?: string; deliveryId?: string; assignmentId?: string; status?: string } }) {
        return reservations.find((row) => (
          (where.id === undefined || row.id === where.id)
          && (where.deliveryId === undefined || row.deliveryId === where.deliveryId)
          && (where.assignmentId === undefined || row.assignmentId === where.assignmentId)
          && (where.status === undefined || row.status === where.status)
        )) ?? null;
      },
      async create({ data }: { data: Row }) {
        const row = { id: `reservation-${reservations.length + 1}`, releasedAt: null, capturedAt: null, ...data };
        reservations.push(row);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: Row }) {
        const row = reservations.find((reservation) => reservation.id === where.id);
        if (!row) throw new Error('reservation missing');
        Object.assign(row, data);
        return row;
      },
    },
    deliveryAssignment: {
      async findUnique({ where }: { where: { id: string } }) {
        return assignments.find((row) => row.id === where.id) ?? null;
      },
      async findFirst({ where }: { where: { id?: string; deliveryId?: string; riderProfileId?: string; status?: string } }) {
        return assignments.find((row) => (
          (where.id === undefined || row.id === where.id)
          && (where.deliveryId === undefined || row.deliveryId === where.deliveryId)
          && (where.riderProfileId === undefined || row.riderProfileId === where.riderProfileId)
          && (where.status === undefined || row.status === where.status)
        )) ?? null;
      },
    },
    async $queryRaw() {
      return [];
    },
  };
  return {
    wallets,
    cash,
    promo,
    reservations,
    tx<T>(work: (client: Prisma.TransactionClient) => Promise<T>) {
      return work(db as unknown as Prisma.TransactionClient);
    },
  };
}
