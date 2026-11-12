import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  AssignmentStatus,
  MotorcycleVerificationStatus,
  RiderApprovalStatus,
  RiderAvailability,
  RiderVerificationStatus,
  WalletActorType,
  WalletEntryType,
} from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { RiderApprovalService } from './rider-approval.service.js';
import { formatSignedCents, signedCentsFromDecimal } from './wallet-money.js';

const NOW = new Date('2026-10-13T12:00:00.000Z');
const LATER = new Date('2026-10-14T12:00:00.000Z');
const ADMIN = { userId: 'admin-1' };

describe('rider approval', () => {
  it('approves a verified rider, selects the registered motorcycle, and stays offline', async () => {
    const ctx = context();
    ctx.motorcycles.push({ id: 'bike-1', riderProfileId: 'profile-1', verificationStatus: MotorcycleVerificationStatus.VERIFIED, isActive: false, createdAt: NOW });
    ctx.profile.verificationStatus = RiderVerificationStatus.VERIFIED;

    await expect(ctx.service.decide(ADMIN, 'profile-1', 'APPROVE', NOW)).resolves.toEqual({
      riderProfileId: 'profile-1',
      approvalStatus: RiderApprovalStatus.APPROVED,
      availability: RiderAvailability.OFFLINE,
      verificationStatus: RiderVerificationStatus.VERIFIED,
    });
    expect(ctx.profile.availability).toBe(RiderAvailability.OFFLINE);
    expect(ctx.motorcycles.find((row) => row.id === 'bike-1')?.isActive).toBe(true);
    expect(ctx.approvalAudits).toEqual([
      expect.objectContaining({
        riderProfileId: 'profile-1',
        actorId: 'admin-1',
        action: 'APPROVE',
        previousApprovalStatus: RiderApprovalStatus.PENDING,
        newApprovalStatus: RiderApprovalStatus.APPROVED,
      }),
    ]);
  });

  it('keeps the earliest verified motorcycle when several are registered', async () => {
    const ctx = context();
    ctx.profile.verificationStatus = RiderVerificationStatus.VERIFIED;
    ctx.motorcycles.push(
      { id: 'bike-later', riderProfileId: 'profile-1', verificationStatus: MotorcycleVerificationStatus.VERIFIED, isActive: false, createdAt: LATER },
      { id: 'bike-first', riderProfileId: 'profile-1', verificationStatus: MotorcycleVerificationStatus.VERIFIED, isActive: false, createdAt: NOW },
      { id: 'bike-pending', riderProfileId: 'profile-1', verificationStatus: MotorcycleVerificationStatus.PENDING, isActive: false, createdAt: NOW },
    );

    await ctx.service.decide(ADMIN, 'profile-1', 'APPROVE', NOW);

    expect(ctx.motorcycles.map((row) => [row.id, row.isActive])).toEqual([
      ['bike-later', false],
      ['bike-first', true],
      ['bike-pending', false],
    ]);
  });

  it('does not replace a motorcycle the rider already selected', async () => {
    const ctx = context();
    ctx.profile.verificationStatus = RiderVerificationStatus.VERIFIED;
    ctx.motorcycles.push(
      { id: 'bike-first', riderProfileId: 'profile-1', verificationStatus: MotorcycleVerificationStatus.VERIFIED, isActive: false, createdAt: NOW },
      { id: 'bike-chosen', riderProfileId: 'profile-1', verificationStatus: MotorcycleVerificationStatus.VERIFIED, isActive: true, createdAt: LATER },
    );

    await ctx.service.decide(ADMIN, 'profile-1', 'APPROVE', NOW);

    expect(ctx.motorcycles.find((row) => row.isActive)?.id).toBe('bike-chosen');
  });

  it('refuses approval without a verified licence or a verified motorcycle', async () => {
    const pending = context();
    pending.motorcycles.push({ id: 'bike-1', riderProfileId: 'profile-1', verificationStatus: MotorcycleVerificationStatus.VERIFIED, isActive: true });
    await expect(pending.service.decide(ADMIN, 'profile-1', 'APPROVE', NOW)).rejects.toBeInstanceOf(ConflictException);
    expect(pending.profile.approvalStatus).toBe(RiderApprovalStatus.PENDING);

    const unlicensed = context();
    unlicensed.profile.verificationStatus = RiderVerificationStatus.VERIFIED;
    await expect(unlicensed.service.decide(ADMIN, 'profile-1', 'APPROVE', NOW)).rejects.toBeInstanceOf(ConflictException);
    expect(unlicensed.profile.approvalStatus).toBe(RiderApprovalStatus.PENDING);
  });

  it('suspends an approved rider and refuses suspension during an accepted delivery', async () => {
    const ctx = context();
    ctx.profile.approvalStatus = RiderApprovalStatus.APPROVED;
    ctx.profile.availability = RiderAvailability.AVAILABLE;
    ctx.assignments.push({ id: 'delivery-1', riderProfileId: 'profile-1', status: AssignmentStatus.ACCEPTED });

    await expect(ctx.service.decide(ADMIN, 'profile-1', 'SUSPEND', NOW)).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.profile).toMatchObject({
      approvalStatus: RiderApprovalStatus.APPROVED,
      availability: RiderAvailability.AVAILABLE,
    });

    ctx.assignments[0].status = AssignmentStatus.OFFERED;
    await expect(ctx.service.decide(ADMIN, 'profile-1', 'SUSPEND', NOW)).resolves.toMatchObject({
      approvalStatus: RiderApprovalStatus.SUSPENDED,
      availability: RiderAvailability.OFFLINE,
    });
    expect(ctx.approvalAudits).toEqual([
      expect.objectContaining({
        actorId: 'admin-1',
        action: 'SUSPEND',
        previousApprovalStatus: RiderApprovalStatus.APPROVED,
        newApprovalStatus: RiderApprovalStatus.SUSPENDED,
      }),
    ]);
  });

  it('awards the active welcome bonus once on first approval', async () => {
    const ctx = ready();
    ctx.configs[0].welcomeBonus = '2.50';
    ctx.configs[0].configVersion = 7;

    await expect(ctx.service.decide(ADMIN, 'profile-1', 'APPROVE', NOW)).resolves.toMatchObject({
      approvalStatus: RiderApprovalStatus.APPROVED,
    });
    expect(ctx.locks[0]).toBe('profile');
    expect(ctx.locks.indexOf('wallet')).toBeGreaterThan(0);
    expect(ctx.entries).toHaveLength(0);
    expect(ctx.promotionalEntries).toEqual([
      expect.objectContaining({
        entryType: 'ISSUED',
        amount: '2.50',
        balanceAfter: '2.50',
        configVersion: 7,
        actorType: WalletActorType.ADMIN,
        actorId: 'admin-1',
        idempotencyKey: 'welcome-bonus:profile-1',
        reservationId: null,
      }),
    ]);
    expect(ctx.wallets[0]).toMatchObject({ balance: '0.00', promotionalBalance: '2.50', welcomeBonusAwardedAt: NOW });
    expect(ledgerCents(ctx)).toBe(signedCentsFromDecimal('2.50'));

    await expect(ctx.service.decide(ADMIN, 'profile-1', 'APPROVE', LATER)).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.promotionalEntries).toHaveLength(1);
    expect(ctx.wallets[0].welcomeBonusAwardedAt).toBe(NOW);
    expect(ctx.wallets[0].balance).toBe('0.00');
    expect(ctx.wallets[0].promotionalBalance).toBe('2.50');
  });

  it('marks a zero welcome bonus as used without posting a credit', async () => {
    const ctx = ready();
    ctx.configs[0].welcomeBonus = '0.00';

    await ctx.service.decide(ADMIN, 'profile-1', 'APPROVE', NOW);

    expect(ctx.profile.approvalStatus).toBe(RiderApprovalStatus.APPROVED);
    expect(ctx.entries).toHaveLength(0);
    expect(ctx.wallets[0]).toMatchObject({ balance: '0.00', welcomeBonusAwardedAt: NOW });
  });

  it('does not award a second bonus when a suspended rider is approved again', async () => {
    const ctx = ready();
    await ctx.service.decide(ADMIN, 'profile-1', 'APPROVE', NOW);
    await ctx.service.decide(ADMIN, 'profile-1', 'SUSPEND', LATER);
    await ctx.service.decide(ADMIN, 'profile-1', 'APPROVE', LATER);

    expect(ctx.profile).toMatchObject({
      approvalStatus: RiderApprovalStatus.APPROVED,
      availability: RiderAvailability.OFFLINE,
    });
    expect(ctx.promotionalEntries).toHaveLength(1);
    expect(ctx.entries).toHaveLength(0);
    expect(ctx.wallets[0]).toMatchObject({ balance: '0.00', promotionalBalance: '1.00', welcomeBonusAwardedAt: NOW });
  });

  it('keeps a backfilled entitlement and does not post a retroactive bonus', async () => {
    const backfilled = new Date('2026-10-01T00:00:00.000Z');
    const approved = ready();
    approved.profile.approvalStatus = RiderApprovalStatus.APPROVED;
    approved.wallets[0].welcomeBonusAwardedAt = backfilled;

    await expect(approved.service.decide(ADMIN, 'profile-1', 'APPROVE', NOW)).rejects.toBeInstanceOf(ConflictException);
    expect(approved.entries).toHaveLength(0);
    expect(approved.wallets[0]).toMatchObject({ balance: '0.00', welcomeBonusAwardedAt: backfilled });

    const suspended = ready();
    suspended.profile.approvalStatus = RiderApprovalStatus.SUSPENDED;
    suspended.wallets[0].welcomeBonusAwardedAt = backfilled;
    await suspended.service.decide(ADMIN, 'profile-1', 'APPROVE', NOW);

    expect(suspended.profile.approvalStatus).toBe(RiderApprovalStatus.APPROVED);
    expect(suspended.entries).toHaveLength(0);
    expect(suspended.wallets[0]).toMatchObject({ balance: '0.00', welcomeBonusAwardedAt: backfilled });
  });

  it('rolls approval back when the bonus posting fails', async () => {
    const missing = ready();
    missing.configs.splice(0, missing.configs.length);
    await expect(missing.service.decide(ADMIN, 'profile-1', 'APPROVE', NOW)).rejects.toBeInstanceOf(ConflictException);
    expect(missing.profile.approvalStatus).toBe(RiderApprovalStatus.PENDING);
    expect(missing.entries).toHaveLength(0);
    expect(missing.wallets[0].welcomeBonusAwardedAt).toBeNull();

    const drifted = ready();
    drifted.wallets[0].balance = '5.00';
    await expect(drifted.service.decide(ADMIN, 'profile-1', 'APPROVE', NOW)).rejects.toBeInstanceOf(ConflictException);
    expect(drifted.profile.approvalStatus).toBe(RiderApprovalStatus.PENDING);
    expect(drifted.entries).toHaveLength(0);
    expect(drifted.wallets[0]).toMatchObject({ balance: '5.00', welcomeBonusAwardedAt: null });
  });

  it('lets one of two concurrent approvals award the bonus', async () => {
    const ctx = ready();
    ctx.pauseFirstLock = true;
    const first = ctx.service.decide(ADMIN, 'profile-1', 'APPROVE', NOW);
    await waitUntil(() => ctx.paused);
    const second = ctx.service.decide(ADMIN, 'profile-1', 'APPROVE', NOW);
    await waitUntil(() => ctx.waiting > 0);
    ctx.releasePause();

    const results = await Promise.allSettled([first, second]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(ctx.profile.approvalStatus).toBe(RiderApprovalStatus.APPROVED);
    expect(ctx.promotionalEntries).toHaveLength(1);
    expect(ctx.entries).toHaveLength(0);
    expect(ctx.wallets[0]).toMatchObject({ balance: '0.00', promotionalBalance: '1.00', welcomeBonusAwardedAt: NOW });
    expect(ledgerCents(ctx)).toBe(100);
  });
});

type ProfileRow = {
  id: string;
  verificationStatus: RiderVerificationStatus;
  approvalStatus: RiderApprovalStatus;
  availability: RiderAvailability;
};

function ready() {
  const ctx = context();
  ctx.profile.verificationStatus = RiderVerificationStatus.VERIFIED;
  ctx.motorcycles.push({
    id: 'bike-1',
    riderProfileId: 'profile-1',
    verificationStatus: MotorcycleVerificationStatus.VERIFIED,
    isActive: false,
  });
  return ctx;
}

function ledgerCents(ctx: ReturnType<typeof context>): number {
  return ctx.promotionalEntries.reduce((sum, entry) => sum + signedCentsFromDecimal(String(entry.amount)), 0);
}

function context() {
  const profiles: ProfileRow[] = [{
    id: 'profile-1',
    verificationStatus: RiderVerificationStatus.PENDING,
    approvalStatus: RiderApprovalStatus.PENDING,
    availability: RiderAvailability.OFFLINE,
  }];
  const motorcycles: Array<{ id: string; riderProfileId: string; verificationStatus: MotorcycleVerificationStatus; isActive: boolean; createdAt?: Date }> = [];
  const assignments: Array<{ id: string; riderProfileId: string; status: AssignmentStatus }> = [];
  const configs: Array<Record<string, unknown>> = [{
    id: 'config-1',
    configVersion: 1,
    welcomeBonus: '1.00',
    defaultBorrowingLimit: '1.00',
    platformFee: '0.30',
    isActive: true,
  }];
  const wallets: Array<Record<string, unknown>> = [{
    id: 'wallet-1',
    riderProfileId: 'profile-1',
    currency: 'USD',
    balance: '0.00',
    borrowingLimitOverride: null,
    welcomeBonusAwardedAt: null,
  }];
  const entries: Array<Record<string, unknown>> = [];
  const promotionalEntries: Array<Record<string, unknown>> = [];
  const approvalAudits: Array<Record<string, unknown>> = [];
  const locks: string[] = [];
  const state = { pauseFirstLock: false, paused: false, waiting: 0 };
  let releasePause: () => void = () => undefined;
  const pause = new Promise<void>((resolve) => {
    releasePause = resolve;
  });
  const holders = new Map<string, { txId: number; depth: number; wait: Promise<void>; resolve: () => void }>();
  let txSerial = 0;
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
      const gate = holders.get(id);
      await gate?.wait;
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
  const models = {
    riderProfile: {
      async findUnique({ where }: { where: { id: string } }) {
        return profiles.find((profile) => profile.id === where.id) ?? null;
      },
      async update({ where, data }: { where: { id: string }; data: Partial<ProfileRow> }) {
        const profile = profiles.find((row) => row.id === where.id);
        if (!profile) throw new Error('profile missing');
        Object.assign(profile, data);
        return profile;
      },
    },
    motorcycle: {
      async count({ where }: { where: { riderProfileId: string; verificationStatus: MotorcycleVerificationStatus } }) {
        return motorcycles.filter((row) => row.riderProfileId === where.riderProfileId && row.verificationStatus === where.verificationStatus).length;
      },
      async findFirst({ where }: { where: { riderProfileId?: string; verificationStatus?: MotorcycleVerificationStatus; isActive?: boolean } }) {
        const rows = motorcycles.filter((row) => (
          (where.riderProfileId === undefined || row.riderProfileId === where.riderProfileId)
          && (where.verificationStatus === undefined || row.verificationStatus === where.verificationStatus)
          && (where.isActive === undefined || row.isActive === where.isActive)
        ));
        rows.sort((left, right) => {
          const leftTime = left.createdAt?.getTime() ?? 0;
          const rightTime = right.createdAt?.getTime() ?? 0;
          if (leftTime !== rightTime) return leftTime - rightTime;
          return left.id.localeCompare(right.id);
        });
        return rows[0] ?? null;
      },
      async update({ where, data }: { where: { id: string }; data: { isActive?: boolean; updatedAt?: Date } }) {
        const row = motorcycles.find((candidate) => candidate.id === where.id);
        if (!row) throw new Error('missing motorcycle');
        Object.assign(row, data);
        return row;
      },
    },
    deliveryAssignment: {
      async findFirst({ where }: { where: { riderProfileId: string; status: AssignmentStatus } }) {
        return assignments.find((row) => row.riderProfileId === where.riderProfileId && row.status === where.status) ?? null;
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
          return wallets.find((wallet) => wallet.riderProfileId === where.riderProfileId) ?? null;
        }
        return wallets.find((wallet) => wallet.id === where.id) ?? null;
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const row = { id: `wallet-${wallets.length + 1}`, welcomeBonusAwardedAt: null, borrowingLimitOverride: null, ...data };
        wallets.push(row);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        if ('balance' in data && 'welcomeBonusAwardedAt' in data) {
          throw new Error('welcome bonus rewrote the balance in the same update');
        }
        const row = wallets.find((wallet) => wallet.id === where.id);
        if (!row) throw new Error('wallet missing');
        Object.assign(row, data);
        return row;
      },
    },
    riderWalletEntry: {
      async findUnique({ where }: { where: { idempotencyKey?: string; walletPaymentId?: string } }) {
        if (where.idempotencyKey) {
          return entries.find((entry) => entry.idempotencyKey === where.idempotencyKey) ?? null;
        }
        return entries.find((entry) => entry.walletPaymentId === where.walletPaymentId) ?? null;
      },
      async aggregate({ where }: { where: { riderWalletId: string } }) {
        const rows = entries.filter((entry) => entry.riderWalletId === where.riderWalletId);
        if (rows.length === 0) return { _sum: { amount: null } };
        const cents = rows.reduce((sum, entry) => sum + signedCentsFromDecimal(String(entry.amount)), 0);
        return { _sum: { amount: formatSignedCents(cents) } };
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const row = { id: `entry-${entries.length + 1}`, ...data };
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
    riderApprovalAudit: {
      async create({ data }: { data: Record<string, unknown> }) {
        const row = { id: `approval-audit-${approvalAudits.length + 1}`, ...data };
        approvalAudits.push(row);
        return row;
      },
      async update() {
        throw new Error('approval audit was changed');
      },
      async delete() {
        throw new Error('approval audit was changed');
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
  };
  const db = {
    ...models,
    async $transaction<T>(callback: (tx: object) => Promise<T>) {
      const txId = ++txSerial;
      const releases: Array<() => void> = [];
      const captured: {
        snapshot: {
          profiles: ProfileRow[];
          motorcycles: Array<{ id: string; riderProfileId: string; verificationStatus: MotorcycleVerificationStatus; isActive: boolean; createdAt?: Date }>;
          wallets: Array<Record<string, unknown>>;
          entries: Array<Record<string, unknown>>;
          promotionalEntries: Array<Record<string, unknown>>;
          approvalAudits: Array<Record<string, unknown>>;
        } | null;
      } = { snapshot: null };
      const capture = () => {
        if (!captured.snapshot) {
          captured.snapshot = {
            profiles: structuredClone(profiles),
            motorcycles: structuredClone(motorcycles),
            wallets: structuredClone(wallets),
            entries: structuredClone(entries),
            promotionalEntries: structuredClone(promotionalEntries),
            approvalAudits: structuredClone(approvalAudits),
          };
        }
      };
      const tx = {
        ...models,
        riderProfile: {
          ...models.riderProfile,
          async update(args: { where: { id: string }; data: Partial<ProfileRow> }) {
            capture();
            return models.riderProfile.update(args);
          },
        },
        riderWallet: {
          ...models.riderWallet,
          async create(args: { data: Record<string, unknown> }) {
            capture();
            return models.riderWallet.create(args);
          },
          async update(args: { where: { id: string }; data: Record<string, unknown> }) {
            capture();
            return models.riderWallet.update(args);
          },
        },
        riderWalletEntry: {
          ...models.riderWalletEntry,
          async create(args: { data: Record<string, unknown> }) {
            capture();
            return models.riderWalletEntry.create(args);
          },
        },
        async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
          const release = await models.$queryRaw(strings, values, txId);
          if (typeof release === 'function') releases.push(release);
          return [];
        },
        $transaction: (inner: (client: object) => Promise<unknown>) => db.$transaction(inner),
      };
      try {
        return await callback(tx);
      } catch (error) {
        const snapshot = captured.snapshot;
        if (snapshot) {
          profiles.splice(0, profiles.length, ...snapshot.profiles);
          motorcycles.splice(0, motorcycles.length, ...snapshot.motorcycles);
          wallets.splice(0, wallets.length, ...snapshot.wallets);
          entries.splice(0, entries.length, ...snapshot.entries);
          promotionalEntries.splice(0, promotionalEntries.length, ...snapshot.promotionalEntries);
          approvalAudits.splice(0, approvalAudits.length, ...snapshot.approvalAudits);
        }
        throw error;
      } finally {
        for (const release of releases) release();
      }
    },
  };
  return {
    service: new RiderApprovalService(db as unknown as PrismaService),
    motorcycles,
    assignments,
    configs,
    wallets,
    entries,
    promotionalEntries,
    approvalAudits,
    locks,
    get profile() {
      return profiles[0];
    },
    get paused() {
      return state.paused;
    },
    get waiting() {
      return state.waiting;
    },
    get pauseFirstLock() {
      return state.pauseFirstLock;
    },
    set pauseFirstLock(value: boolean) {
      state.pauseFirstLock = value;
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
