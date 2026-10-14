import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { WalletActorType, WalletEntryType } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import {
  capturePlatformFeeReservation,
  postLedgerEntry,
} from './wallet-ledger.js';
import { formatSignedCents, signedCentsFromDecimal } from './wallet-money.js';

const NOW = new Date('2026-10-14T15:00:00.000Z');

describe('capturePlatformFeeReservation', () => {
  it('debits the reserved fee once and replays without a second debit', async () => {
    const ctx = context();
    const first = await capture(ctx, 'profile-1');
    const topUp = ctx.entries[0];
    expect(first).toMatchObject({
      captured: true,
      replayed: false,
      amount: '-0.30',
      balance: '1.70',
      configVersion: 3,
      currency: 'USD',
    });
    const fee = ctx.entries.find((entry) => entry.entryType === 'PLATFORM_FEE');
    expect(fee).toMatchObject({
      amount: '-0.30',
      balanceAfter: '1.70',
      configVersion: 3,
      idempotencyKey: 'platform-fee:delivery-1',
      actorType: 'SYSTEM',
      actorId: null,
      walletPaymentId: null,
    });
    expect(ctx.reservations[0]).toMatchObject({ status: 'CAPTURED', capturedAt: NOW, releasedAt: null });
    expect(ctx.wallets[0]?.balance).toBe('1.70');
    expect(topUp).toMatchObject({ entryType: 'TOP_UP', amount: '2.00' });

    const replay = await capture(ctx, 'profile-1');
    expect(replay).toMatchObject({ captured: true, replayed: true, entryId: first.entryId, balance: '1.70' });
    expect(ctx.entries.filter((entry) => entry.entryType === 'PLATFORM_FEE')).toHaveLength(1);
    expect(ctx.wallets[0]?.balance).toBe('1.70');
    expect(ctx.lockLog).toEqual(['profile', 'wallet', 'profile', 'wallet']);
  });

  it('lets the first of two concurrent captures debit the wallet', async () => {
    const ctx = context();
    const results = await Promise.all([
      capture(ctx, 'profile-1'),
      capture(ctx, 'profile-1'),
    ]);
    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect(ctx.entries.filter((entry) => entry.entryType === 'PLATFORM_FEE')).toHaveLength(1);
    expect(ctx.wallets[0]?.balance).toBe('1.70');
    expect(ctx.reservations[0]?.status).toBe('CAPTURED');
  });

  it('rejects another rider and a released reservation', async () => {
    const wrongRider = context();
    await expect(capture(wrongRider, 'profile-2')).rejects.toBeInstanceOf(ConflictException);
    expect(wrongRider.reservations[0]?.status).toBe('OPEN');
    expect(wrongRider.entries.filter((entry) => entry.entryType === 'PLATFORM_FEE')).toHaveLength(0);

    const released = context();
    released.reservations[0]!.status = 'RELEASED';
    released.reservations[0]!.releasedAt = NOW;
    await expect(capture(released, 'profile-1')).rejects.toMatchObject({
      message: 'This platform fee reservation was released',
    });
    expect(released.reservations[0]).toMatchObject({ status: 'RELEASED', capturedAt: null });
    expect(released.wallets[0]?.balance).toBe('2.00');
    expect(released.entries.map((entry) => entry.entryType)).toEqual(['TOP_UP', 'TOP_UP']);
  });

  it('posts nothing for a zero fee and rejects a missing positive reservation', async () => {
    const zero = context({
      reservation: false,
      acceptedPlatformFee: '0.00',
      acceptedFeeConfigVersion: 3,
      platformFee: '0.80',
    });
    const result = await capture(zero, 'profile-1');
    expect(result).toMatchObject({
      captured: false,
      replayed: false,
      amount: '0.00',
      balance: '2.00',
      configVersion: 3,
      entryId: null,
    });
    expect(zero.entries.map((entry) => entry.entryType)).toEqual(['TOP_UP', 'TOP_UP']);
    expect(zero.reservations).toHaveLength(0);
    expect(zero.assignments[0]).toMatchObject({ acceptedPlatformFee: '0.00', acceptedFeeConfigVersion: 3 });

    const missing = context({
      reservation: false,
      acceptedPlatformFee: '0.30',
      acceptedFeeConfigVersion: 3,
      platformFee: '0.00',
    });
    await expect(capture(missing, 'profile-1')).rejects.toMatchObject({
      message: 'Platform fee reservation was not found',
    });
    expect(missing.entries.map((entry) => entry.entryType)).toEqual(['TOP_UP', 'TOP_UP']);
    expect(missing.wallets[0]?.balance).toBe('2.00');
  });

  it('captures the original amount after the platform fee changes', async () => {
    const ctx = context();
    ctx.configs[0]!.isActive = false;
    ctx.configs.push({
      id: 'config-4',
      configVersion: 4,
      platformFee: '0.80',
      isActive: true,
    });
    const captured = await capture(ctx, 'profile-1');
    expect(captured).toMatchObject({ amount: '-0.30', configVersion: 3, balance: '1.70' });
    expect(ctx.entries.find((entry) => entry.entryType === 'PLATFORM_FEE')).toMatchObject({
      amount: '-0.30',
      configVersion: 3,
    });
    expect(ctx.assignments[0]).toMatchObject({ acceptedPlatformFee: '0.30', acceptedFeeConfigVersion: 3 });
  });

  it('rejects a reservation that does not match the accepted snapshot', async () => {
    const ctx = context({ acceptedPlatformFee: '0.80', acceptedFeeConfigVersion: 4 });
    await expect(capture(ctx, 'profile-1')).rejects.toMatchObject({
      message: 'Platform fee reservation is corrupted',
    });
    expect(ctx.reservations[0]?.status).toBe('OPEN');
    expect(ctx.entries.map((entry) => entry.entryType)).toEqual(['TOP_UP', 'TOP_UP']);
    expect(ctx.wallets[0]?.balance).toBe('2.00');
  });

  it('keeps a later rider zero-fee capture independent of an earlier released reservation', async () => {
    const ctx = context({
      reservation: false,
      acceptedPlatformFee: '0.00',
      acceptedFeeConfigVersion: 5,
      platformFee: '1.00',
    });
    ctx.reservations.push({
      id: 'released-earlier',
      riderWalletId: 'wallet-2',
      deliveryId: 'delivery-1',
      amount: '0.30',
      currency: 'USD',
      configVersion: 2,
      status: 'RELEASED',
      releasedAt: NOW,
      capturedAt: null,
    });
    const result = await capture(ctx, 'profile-1');
    expect(result).toMatchObject({ captured: false, amount: '0.00', configVersion: 5, entryId: null });
    expect(ctx.entries.filter((entry) => entry.entryType === 'PLATFORM_FEE')).toHaveLength(0);
    expect(ctx.reservations[0]?.status).toBe('RELEASED');
  });

  it('rolls the debit back when marking the reservation captured fails', async () => {
    const ctx = context();
    ctx.failReservationUpdate = true;
    await expect(capture(ctx, 'profile-1')).rejects.toThrow('reservation update failed');
    expect(ctx.reservations[0]).toMatchObject({ status: 'OPEN', capturedAt: null });
    expect(ctx.entries.map((entry) => entry.entryType)).toEqual(['TOP_UP', 'TOP_UP']);
    expect(ctx.wallets[0]?.balance).toBe('2.00');
  });

  it('still refuses platform fee posting through the general ledger path', async () => {
    const ctx = context();
    await expect(postLedgerEntry(ctx.prisma as unknown as Prisma.TransactionClient, {
      riderProfileId: 'profile-1',
      entryType: WalletEntryType.PLATFORM_FEE,
      amountCents: -30,
      idempotencyKey: 'manual-fee',
      reason: null,
      walletPaymentId: null,
      actorType: WalletActorType.SYSTEM,
      actorId: null,
      now: NOW,
    })).rejects.toMatchObject({ message: 'Platform fee posting is not available' });
    expect(ctx.entries.map((entry) => entry.entryType)).toEqual(['TOP_UP', 'TOP_UP']);
    expect(ctx.wallets[0]?.balance).toBe('2.00');
  });
});

type Row = Record<string, any>;

function capture(ctx: ReturnType<typeof context>, riderProfileId: string) {
  return ctx.prisma.$transaction((tx) => capturePlatformFeeReservation(tx, 'delivery-1', riderProfileId, NOW));
}

function context(options: {
  platformFee?: string;
  reservation?: boolean;
  acceptedPlatformFee?: string;
  acceptedFeeConfigVersion?: number;
} = {}) {
  const wallets: Row[] = [
    { id: 'wallet-1', riderProfileId: 'profile-1', balance: '2.00', currency: 'USD' },
    { id: 'wallet-2', riderProfileId: 'profile-2', balance: '2.00', currency: 'USD' },
  ];
  const entries: Row[] = [
    feeEntry('wallet-1', 'entry-topup', 'TOP_UP', '2.00', '2.00'),
    feeEntry('wallet-2', 'entry-topup-2', 'TOP_UP', '2.00', '2.00'),
  ];
  const reservations: Row[] = options.reservation === false ? [] : [{
    id: 'reservation-1',
    riderWalletId: 'wallet-1',
    deliveryId: 'delivery-1',
    amount: '0.30',
    currency: 'USD',
    configVersion: 3,
    status: 'OPEN',
    releasedAt: null,
    capturedAt: null,
  }];
  const configs: Row[] = [{
    id: 'config-3',
    configVersion: 3,
    platformFee: options.platformFee ?? '0.30',
    isActive: true,
  }];
  const assignments: Row[] = [{
    id: 'assignment-1',
    deliveryId: 'delivery-1',
    riderProfileId: 'profile-1',
    status: 'ACCEPTED',
    acceptedPlatformFee: options.acceptedPlatformFee ?? (options.reservation === false ? (options.platformFee ?? '0.30') : '0.30'),
    acceptedFeeConfigVersion: options.acceptedFeeConfigVersion ?? 3,
  }];
  const lockLog: string[] = [];
  const state = { failReservationUpdate: false };
  const mutexes = new Map<string, Mutex>();
  let sequence = 1;

  const client = {
    async $transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
      const snapshot = {
        wallets: structuredClone(wallets),
        entries: structuredClone(entries),
        reservations: structuredClone(reservations),
      };
      const releases: Array<() => void> = [];
      const tx = {
        async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
          const sql = strings.join(' ');
          if (sql.includes('"rider_profiles"')) {
            lockLog.push('profile');
            await hold(mutexes, `profile:${String(values[0])}`, releases);
          } else if (sql.includes('"rider_wallets"')) {
            lockLog.push('wallet');
            await hold(mutexes, `wallet:${String(values[0])}`, releases);
          }
          return [];
        },
        riderProfile: {
          async findUnique({ where }: { where: Row }) {
            const profiles = [{ id: 'profile-1' }, { id: 'profile-2' }];
            return clone(profiles.find((row) => matches(row, where)));
          },
        },
        riderWallet: {
          async findUnique({ where }: { where: Row }) {
            return clone(wallets.find((row) => matches(row, where)));
          },
          async update({ where, data }: { where: Row; data: Row }) {
            const row = wallets.find((item) => matches(item, where));
            if (!row) throw new Error('missing wallet');
            Object.assign(row, data);
            return clone(row);
          },
        },
        riderWalletEntry: {
          async findUnique({ where }: { where: Row }) {
            return clone(entries.find((row) => matches(row, where)));
          },
          async create({ data }: { data: Row }) {
            const row = { id: `entry-${sequence++}`, ...data };
            entries.push(row);
            return clone(row);
          },
          async aggregate({ where }: { where: Row }) {
            const rows = entries.filter((row) => matches(row, where));
            if (rows.length === 0) return { _sum: { amount: null } };
            const total = rows.reduce((sum, row) => sum + signedCentsFromDecimal(String(row.amount)), 0);
            return { _sum: { amount: formatSignedCents(total) } };
          },
        },
        walletFeeReservation: {
          async findMany({ where }: { where: Row }) {
            return reservations.filter((row) => matches(row, where)).map((row) => structuredClone(row));
          },
          async update({ where, data }: { where: Row; data: Row }) {
            if (state.failReservationUpdate) {
              state.failReservationUpdate = false;
              throw new Error('reservation update failed');
            }
            const row = reservations.find((item) => matches(item, where));
            if (!row) throw new Error('missing reservation');
            Object.assign(row, data);
            return clone(row);
          },
        },
        walletConfig: {
          async findFirst({ where }: { where: Row }) {
            return clone(configs.find((row) => matches(row, where)));
          },
        },
        deliveryAssignment: {
          async findFirst({ where }: { where: Row }) {
            return clone(assignments.find((row) => matches(row, where)));
          },
        },
      };
      try {
        return await work(tx as unknown as Prisma.TransactionClient);
      } catch (error) {
        wallets.splice(0, wallets.length, ...snapshot.wallets);
        entries.splice(0, entries.length, ...snapshot.entries);
        reservations.splice(0, reservations.length, ...snapshot.reservations);
        throw error;
      } finally {
        for (const release of releases.reverse()) release();
      }
    },
  };

  return {
    prisma: client,
    entries,
    reservations,
    wallets,
    assignments,
    configs,
    lockLog,
    get failReservationUpdate() { return state.failReservationUpdate; },
    set failReservationUpdate(value: boolean) { state.failReservationUpdate = value; },
  };
}

function feeEntry(walletId: string, id: string, entryType: string, amount: string, balanceAfter: string): Row {
  return {
    id,
    riderWalletId: walletId,
    entryType,
    amount,
    balanceAfter,
    currency: 'USD',
    configVersion: 3,
    idempotencyKey: `seed:${id}`,
    payloadHash: 'a'.repeat(64),
    walletPaymentId: null,
    reason: null,
    actorType: 'SYSTEM',
    actorId: null,
  };
}

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

function clone(row: Row | undefined): Row | null {
  return row ? structuredClone(row) : null;
}

type Mutex = { owner: boolean; waiters: Array<() => void> };

async function hold(mutexes: Map<string, Mutex>, key: string, releases: Array<() => void>): Promise<void> {
  let mutex = mutexes.get(key);
  if (!mutex) {
    mutex = { owner: false, waiters: [] };
    mutexes.set(key, mutex);
  }
  if (mutex.owner) {
    await new Promise<void>((resolve) => {
      mutex.waiters.push(resolve);
    });
  }
  mutex.owner = true;
  releases.push(() => {
    const next = mutex.waiters.shift();
    if (next) next();
    else mutex.owner = false;
  });
}
