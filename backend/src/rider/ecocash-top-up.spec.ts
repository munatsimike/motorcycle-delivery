import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { Currency, WalletPaymentMethod, WalletPaymentStatus } from '../generated/prisma/client.js';
import type { EcocashPaymentProvider, EcocashProviderResult } from './ecocash-client.js';
import { initiateEcocashTopUp, lookupEcocashTopUp, normalizeEcocashMsisdn, reconcileEcocashTopUps } from './ecocash-top-up.js';
import type { PrismaClientLike } from './ecocash-top-up.js';

const NOW = new Date('2026-11-06T12:00:00.000Z');
const RIDER = { userId: 'user-1', riderProfileId: 'profile-1' };
const PAYMENT_ID = '01936b6a-7c8d-7000-8000-000000000001';

describe('EcoCash top-up initiation and lookup', () => {
  const previous = new Map<string, string | undefined>();

  afterEach(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    previous.clear();
  });

  it('normalizes an EcoCash number without changing the subscriber', () => {
    expect(normalizeEcocashMsisdn('0771234567')).toBe('771234567');
    expect(normalizeEcocashMsisdn('+263771234567')).toBe('771234567');
    expect(normalizeEcocashMsisdn('771234567')).toBe('771234567');
  });

  it('persists a pending payment before the charge and does not credit the wallet', async () => {
    const ctx = context();
    enable(previous);
    const result = await initiateEcocashTopUp(ctx.db, ctx.provider([charged()]), RIDER, body(), 'top-up-1', NOW);
    expect(ctx.events[0]).toBe('transaction');
    expect(ctx.events.at(-1)).toBe('charge');
    expect(ctx.openDuringCharge).toBe(false);
    expect(result).toMatchObject({
      status: WalletPaymentStatus.PENDING,
      amountCents: 250,
      currency: 'USD',
      payerMsisdn: '771234567',
      providerReference: 'MP1',
      replayed: false,
      credited: false,
    });
    expect(ctx.balanceWrites).toBe(0);
    expect(ctx.ledgerWrites).toBe(0);
    expect(ctx.payments[0]).toMatchObject({
      method: WalletPaymentMethod.GATEWAY,
      provider: 'ECOCASH',
      status: WalletPaymentStatus.PENDING,
      chargeAttemptedAt: NOW,
    });
  });

  it('returns the same pending payment for an identical retry and a matching second request', async () => {
    const ctx = context();
    enable(previous);
    const provider = ctx.provider([charged()]);
    const first = await initiateEcocashTopUp(ctx.db, provider, RIDER, body(), 'top-up-1', NOW);
    const retry = await initiateEcocashTopUp(ctx.db, provider, RIDER, body(), 'top-up-1', NOW);
    const secondKey = await initiateEcocashTopUp(ctx.db, provider, RIDER, body(), 'top-up-2', NOW);
    expect(retry.paymentId).toBe(first.paymentId);
    expect(secondKey.paymentId).toBe(first.paymentId);
    expect(retry.replayed).toBe(true);
    expect(ctx.charges).toBe(1);
    expect(ctx.payments).toHaveLength(1);
  });

  it('rejects the same idempotency key when the amount changes', async () => {
    const ctx = context();
    enable(previous);
    await initiateEcocashTopUp(ctx.db, ctx.provider([charged()]), RIDER, body(), 'top-up-1', NOW);
    const mismatch = initiateEcocashTopUp(ctx.db, ctx.provider([charged()]), RIDER, body('3.00'), 'top-up-1', NOW);
    await expect(mismatch).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.payments).toHaveLength(1);
  });

  it('keeps a timed-out charge pending and marks a decline failed', async () => {
    const timeout = context();
    enable(previous);
    const pending = await initiateEcocashTopUp(timeout.db, timeout.provider([{ kind: 'uncertain', reason: 'timeout' }]), RIDER, body(), 'top-up-1', NOW);
    expect(pending.status).toBe(WalletPaymentStatus.PENDING);
    expect(timeout.payments[0]?.status).toBe(WalletPaymentStatus.PENDING);

    const decline = context();
    const failed = await initiateEcocashTopUp(decline.db, decline.provider([{ kind: 'declined', httpStatus: 422, responseCode: '05' }]), RIDER, body(), 'top-up-2', NOW);
    expect(failed.status).toBe(WalletPaymentStatus.FAILED);
    expect(decline.ledgerWrites).toBe(0);
  });

  it('verifies a matching lookup without a ledger credit', async () => {
    const ctx = context();
    enable(previous);
    const started = await initiateEcocashTopUp(ctx.db, ctx.provider([charged()]), RIDER, body(), 'top-up-1', NOW);
    const lookedUp = await lookupEcocashTopUp(ctx.db, ctx.provider([charged(started.clientCorrelator, started.referenceCode)]), RIDER, started.paymentId, NOW);
    expect(lookedUp).toMatchObject({ status: WalletPaymentStatus.VERIFIED, credited: false, providerReference: 'MP1' });
    expect(ctx.balanceWrites).toBe(0);
    expect(ctx.ledgerWrites).toBe(0);
    expect(ctx.payments[0]?.amount).toBe('2.50');
  });

  it('does not treat a timeout or an early miss as an uncharged payment', async () => {
    const ctx = context();
    enable(previous);
    const started = await initiateEcocashTopUp(ctx.db, ctx.provider([charged()]), RIDER, body(), 'top-up-1', NOW);
    const timedOut = await lookupEcocashTopUp(ctx.db, ctx.provider([{ kind: 'uncertain', reason: 'timeout' }]), RIDER, started.paymentId, NOW);
    expect(timedOut.status).toBe(WalletPaymentStatus.PENDING);
    const missing = await lookupEcocashTopUp(ctx.db, ctx.provider([{ kind: 'not_found' }]), RIDER, started.paymentId, NOW);
    expect(missing.status).toBe(WalletPaymentStatus.PENDING);
    const expired = await lookupEcocashTopUp(
      ctx.db,
      ctx.provider([{ kind: 'not_found' }]),
      RIDER,
      started.paymentId,
      new Date(NOW.getTime() + 16 * 60 * 1000),
    );
    expect(expired.status).toBe(WalletPaymentStatus.EXPIRED);
    expect(ctx.ledgerWrites).toBe(0);
  });

  it('leaves a mismatched lookup unresolved and does not change the stored amount', async () => {
    const ctx = context();
    enable(previous);
    const started = await initiateEcocashTopUp(ctx.db, ctx.provider([charged()]), RIDER, body(), 'top-up-1', NOW);
    const mismatch = charged(started.clientCorrelator, started.referenceCode);
    if (mismatch.kind === 'transaction') mismatch.transaction.amountCents = 999;
    const result = await lookupEcocashTopUp(ctx.db, ctx.provider([mismatch]), RIDER, started.paymentId, NOW);
    expect(result.status).toBe(WalletPaymentStatus.UNRESOLVED);
    expect(result.amountCents).toBe(250);
    expect(ctx.balanceWrites).toBe(0);
  });

  it('keeps a charged lookup unresolved when the provider omits amount or currency', async () => {
    const ctx = context();
    enable(previous);
    const started = await initiateEcocashTopUp(ctx.db, ctx.provider([charged()]), RIDER, body(), 'top-up-1', NOW);
    const omitted = charged(started.clientCorrelator, started.referenceCode);
    if (omitted.kind === 'transaction') {
      omitted.transaction.amountCents = null;
      omitted.transaction.currency = null;
    }
    const result = await lookupEcocashTopUp(ctx.db, ctx.provider([omitted]), RIDER, started.paymentId, NOW);
    expect(result.status).toBe(WalletPaymentStatus.UNRESOLVED);
    expect(ctx.payments[0]?.lastProviderResponseCode).toBe('AMOUNT_CURRENCY_UNVERIFIED');
    expect(ctx.ledgerWrites).toBe(0);
    expect(ctx.balanceWrites).toBe(0);
  });

  it('looks up an expired or failed payment again without sending another charge', async () => {
    const ctx = context();
    enable(previous);
    const started = await initiateEcocashTopUp(ctx.db, ctx.provider([charged()]), RIDER, body(), 'top-up-1', NOW);
    const expired = await lookupEcocashTopUp(
      ctx.db,
      ctx.provider([{ kind: 'not_found' }]),
      RIDER,
      started.paymentId,
      new Date(NOW.getTime() + 16 * 60 * 1000),
    );
    expect(expired.status).toBe(WalletPaymentStatus.EXPIRED);
    const late = await lookupEcocashTopUp(
      ctx.db,
      ctx.provider([charged(started.clientCorrelator, started.referenceCode)]),
      RIDER,
      started.paymentId,
      new Date(NOW.getTime() + 20 * 60 * 1000),
    );
    expect(late).toMatchObject({ status: WalletPaymentStatus.VERIFIED, credited: false });
    ctx.payments[0]!.status = WalletPaymentStatus.FAILED;
    ctx.payments[0]!.verifiedAt = null;
    const recovered = await lookupEcocashTopUp(ctx.db, ctx.provider([charged(started.clientCorrelator, started.referenceCode)]), RIDER, started.paymentId, NOW);
    expect(recovered.status).toBe(WalletPaymentStatus.VERIFIED);
    expect(ctx.charges).toBe(1);
    expect(ctx.ledgerWrites).toBe(0);
  });

  it('reconciles a claimed payment with lookup and does not charge again', async () => {
    const ctx = context();
    enable(previous);
    const started = await initiateEcocashTopUp(ctx.db, ctx.provider([{ kind: 'uncertain', reason: 'timeout' }]), RIDER, body(), 'top-up-1', NOW);
    expect(started.status).toBe(WalletPaymentStatus.PENDING);
    ctx.payments[0]!.nextLookupAt = new Date(NOW.getTime() - 1000);
    const provider = ctx.provider([charged(started.clientCorrelator, started.referenceCode)]);
    const processed = await reconcileEcocashTopUps(ctx.db, provider, NOW);
    expect(processed).toBe(1);
    expect(ctx.charges).toBe(1);
    expect(ctx.payments[0]?.status).toBe(WalletPaymentStatus.VERIFIED);
    expect(ctx.ledgerWrites).toBe(0);
    expect(ctx.balanceWrites).toBe(0);
  });

  it('does not create a payment when sandbox configuration is disabled', async () => {
    remember(previous, { ECOCASH_ENABLED: 'false', NODE_ENV: 'development' });
    const ctx = context();
    await expect(initiateEcocashTopUp(ctx.db, ctx.provider([charged()]), RIDER, body(), 'top-up-1', NOW))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(ctx.payments).toHaveLength(0);
    expect(ctx.charges).toBe(0);
  });
});

function body(amount = '2.50') {
  return { amount, currency: Currency.USD, endUserId: '0771234567' };
}

function charged(clientCorrelator = 'ignored', referenceCode = 'ignored'): EcocashProviderResult {
  return {
    kind: 'transaction',
    httpStatus: 200,
    transaction: {
      clientCorrelator,
      referenceCode,
      endUserId: '771234567',
      ecocashReference: 'MP1',
      transactionOperationStatus: 'Charged',
      responseCode: '00',
      amountCents: 250,
      currency: 'USD',
    },
  };
}

function enable(saved: Map<string, string | undefined>): void {
  remember(saved, {
    NODE_ENV: 'development',
    ECOCASH_ENABLED: 'true',
    ECOCASH_ENVIRONMENT: 'sandbox',
    ECOCASH_SANDBOX_BASE_URL: 'https://developers.ecocash.co.zw',
    ECOCASH_USERNAME: 'sandbox-user',
    ECOCASH_PASSWORD: 'sandbox-pass',
    ECOCASH_MERCHANT_CODE: 'ABC123',
    ECOCASH_MERCHANT_NUMBER: '771234567',
    ECOCASH_MERCHANT_PIN: '2468',
    ECOCASH_TERMINAL_ID: 'TERM01',
    ECOCASH_LOCATION: 'Harare',
    ECOCASH_SUPER_MERCHANT_NAME: 'Riders',
    ECOCASH_MERCHANT_NAME: 'Riders',
    ECOCASH_PURCHASE_CATEGORY: 'Online Payment',
    ECOCASH_CHARGE_DESCRIPTION: 'Riders wallet top-up',
  });
}

function remember(saved: Map<string, string | undefined>, env: Record<string, string>): void {
  for (const [key, value] of Object.entries(env)) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    process.env[key] = value;
  }
  for (const key of Object.keys(process.env)) {
    if (!key.startsWith('RAILWAY_') && key !== 'TRUST_RAILWAY_EDGE_CLIENT_IP') continue;
    if (!saved.has(key)) saved.set(key, process.env[key]);
    delete process.env[key];
  }
}

function context() {
  const payments: Array<Record<string, unknown>> = [];
  const events: string[] = [];
  let charges = 0;
  let balanceWrites = 0;
  let ledgerWrites = 0;
  let open = 0;
  let openDuringCharge = false;
  let nextId = 1;
  const db = {
    riderProfile: {
      async findUnique() {
        return { id: 'profile-1' };
      },
    },
    riderWallet: {
      async findUnique() {
        return { id: 'wallet-1', riderProfileId: 'profile-1', balance: '0.00', borrowingLimitOverride: null, welcomeBonusAwardedAt: null };
      },
      async update() {
        balanceWrites += 1;
        throw new Error('wallet balance was changed');
      },
    },
    riderWalletEntry: {
      async create() {
        ledgerWrites += 1;
        throw new Error('ledger entry was created');
      },
    },
    walletPayment: {
      async findUnique({ where, include }: { where: { id?: string; idempotencyKey?: string }; include?: unknown }) {
        const row = payments.find((payment) => payment.id === where.id || payment.idempotencyKey === where.idempotencyKey) ?? null;
        if (!row || !include) return row;
        return { ...row, riderWallet: { riderProfileId: 'profile-1' } };
      },
      async findFirst({ where }: { where: { riderWalletId: string; status: { in: string[] } } }) {
        return payments.find((payment) => payment.riderWalletId === where.riderWalletId && where.status.in.includes(String(payment.status))) ?? null;
      },
      async findMany({ where }: { where?: { status?: { in?: string[] }; chargeAttemptedAt?: { not: null } } }) {
        return payments.filter((payment) => {
          if (where?.status?.in && !where.status.in.includes(String(payment.status))) return false;
          if (where?.chargeAttemptedAt && payment.chargeAttemptedAt == null) return false;
          return true;
        });
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const row = { id: nextId === 1 ? PAYMENT_ID : `payment-${nextId}`, ...data };
        nextId += 1;
        payments.push(row);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const row = payments.find((payment) => payment.id === where.id);
        if (!row) throw new Error('payment missing');
        Object.assign(row, data);
        return row;
      },
      async updateMany({ where, data }: { where: { id?: string; status?: string | { in?: string[] }; chargeAttemptedAt?: null; nextLookupAt?: Date | null }; data: Record<string, unknown> }) {
        const row = payments.find((payment) => {
          if (where.id && payment.id !== where.id) return false;
          if (typeof where.status === 'string' && payment.status !== where.status) return false;
          if (where.status && typeof where.status === 'object' && !where.status.in?.includes(String(payment.status))) return false;
          if ('chargeAttemptedAt' in where && where.chargeAttemptedAt == null && payment.chargeAttemptedAt != null) return false;
          if ('nextLookupAt' in where && String(payment.nextLookupAt) !== String(where.nextLookupAt)) return false;
          return true;
        });
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    async $queryRaw() {
      return [];
    },
    async $transaction<T>(work: (tx: object) => Promise<T>) {
      events.push('transaction');
      open += 1;
      try {
        return await work(db);
      } finally {
        open -= 1;
      }
    },
  };
  return {
    db: db as unknown as PrismaClientLike,
    payments,
    events,
    get charges() {
      return charges;
    },
    get balanceWrites() {
      return balanceWrites;
    },
    get ledgerWrites() {
      return ledgerWrites;
    },
    get openDuringCharge() {
      return openDuringCharge;
    },
    provider(results: EcocashProviderResult[]): EcocashPaymentProvider {
      return {
        async charge(request) {
          charges += 1;
          if (open !== 0) openDuringCharge = true;
          events.push('charge');
          const result = results.shift() ?? { kind: 'uncertain', reason: 'unavailable' };
          if (result.kind === 'transaction') {
            result.transaction.clientCorrelator = request.clientCorrelator;
            result.transaction.referenceCode = request.referenceCode;
          }
          return result;
        },
        async lookup(request) {
          events.push('lookup');
          const result = results.shift() ?? { kind: 'not_found' };
          if (result.kind === 'transaction' && result.transaction.clientCorrelator === 'ignored') {
            result.transaction.clientCorrelator = request.clientCorrelator;
          }
          return result;
        },
      };
    },
  };
}
