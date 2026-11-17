import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Currency, UserRole, WalletEntryType, WalletPaymentMethod, WalletPaymentStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { EcocashPaymentProvider } from './ecocash-client.js';
import { USD_DEBT_AFTER_ZWG_PAYMENT, postEcocashCredit } from './ecocash-credit.js';
import { PAYMENT_METHOD_UNAVAILABLE, initiateEcocashTopUp } from './ecocash-top-up.js';
import { USD_DEBT_MUST_BE_CLEARED } from './wallet-ledger.js';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const PRISMA_CLI = require.resolve('prisma/build/index.js');
const HOST = '127.0.0.1';
const PORT = 54364;
const DATABASE = 'wallet_phase3';
const CONTAINER = 'riders-wallet-phase3-pg';
const DISPOSABLE_URL = `postgresql://postgres:postgres@${HOST}:${PORT}/${DATABASE}`;
const NOW = new Date('2026-11-16T09:00:00.000Z');
const SANDBOX = {
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
};

let prisma: PrismaService;
let phone = 771300000;
let charges = 0;
let paymentSequence = 0;
const previous = new Map<string, string | undefined>();
const provider = {
  async charge() {
    charges += 1;
    return { kind: 'uncertain', reason: 'timeout' };
  },
  async lookup() {
    return { kind: 'not_found' };
  },
} as EcocashPaymentProvider;

beforeAll(async () => {
  const parsed = new URL(DISPOSABLE_URL);
  if (parsed.hostname !== HOST || parsed.port !== String(PORT) || parsed.pathname !== `/${DATABASE}`) {
    throw new Error('Refusing to use a database that is not the disposable wallet phase 3 database');
  }
  if (/supabase|railway|pooler/i.test(DISPOSABLE_URL)) {
    throw new Error('Refusing a hosted database');
  }
  await exec('docker', ['rm', '-f', CONTAINER], { windowsHide: true }).catch(() => undefined);
  await exec('docker', [
    'run', '-d', '--name', CONTAINER,
    '--publish', `${HOST}:${PORT}:5432`,
    '--env', 'POSTGRES_PASSWORD=postgres',
    '--env', `POSTGRES_DB=${DATABASE}`,
    'postgres:17-alpine',
  ], { windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
  await waitForPostgres();
  for (const [key, value] of Object.entries(SANDBOX)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  previous.set('DATABASE_URL', process.env.DATABASE_URL);
  previous.set('DATABASE_SSL_CA', process.env.DATABASE_SSL_CA);
  process.env.DATABASE_URL = DISPOSABLE_URL;
  delete process.env.DATABASE_SSL_CA;
  await exec(process.execPath, [PRISMA_CLI, 'db', 'push', '--accept-data-loss'], {
    cwd: process.cwd(),
    env: process.env,
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  prisma = new PrismaService();
  await prisma.$connect();
  const admin = await prisma.user.create({
    data: { fullName: 'Admin', phone: nextPhone(), role: UserRole.ADMIN, accountStatus: 'ACTIVE', phoneVerifiedAt: NOW },
  });
  await prisma.walletConfig.create({
    data: {
      configVersion: 1,
      currency: 'USD',
      welcomeBonus: '0.00',
      defaultBorrowingLimit: '50.00',
      platformFee: '1.50',
      isActive: true,
      createdById: admin.id,
    },
  });
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect().catch(() => undefined);
  await exec('docker', ['rm', '-f', CONTAINER], { windowsHide: true }).catch(() => undefined);
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}, 60_000);

it('blocks a ZiG top-up when the USD cash balance is negative', async () => {
  const riderId = await createRider('-2.00', '0.00');
  charges = 0;
  await expect(start(riderId, 'ZWG', 'debt')).rejects.toSatisfy((error: ConflictException) => {
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: USD_DEBT_MUST_BE_CLEARED });
    return true;
  });
  expect(charges).toBe(0);
  expect(await prisma.walletPayment.count({ where: { riderWallet: { riderProfileId: riderId, currency: 'ZWG' } } })).toBe(0);
});

it('refuses a ZiG top-up at a zero or positive USD balance because EcoCash ZiG is not configured', async () => {
  charges = 0;
  const zero = await createRider('0.00', '0.00');
  const positive = await createRider('5.00', '0.00');
  await expect(start(zero, 'ZWG', 'zero')).rejects.toBeInstanceOf(ServiceUnavailableException);
  await expect(start(positive, 'ZWG', 'positive')).rejects.toSatisfy((error: ServiceUnavailableException) => {
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(error.getResponse()).toMatchObject({ code: PAYMENT_METHOD_UNAVAILABLE });
    return true;
  });
  expect(charges).toBe(0);
});

it('starts a USD EcoCash top-up while the USD balance is negative', async () => {
  const riderId = await createRider('-2.00', '4.00');
  charges = 0;
  const view = await start(riderId, 'USD', 'usd-debt');
  expect(view.currency).toBe('USD');
  expect(view.status).toBe(WalletPaymentStatus.PENDING);
  expect(charges).toBe(1);
  const payment = await prisma.walletPayment.findUniqueOrThrow({
    where: { id: view.paymentId },
    include: { riderWallet: true },
  });
  expect(payment.currency).toBe(Currency.USD);
  expect(payment.riderWallet.currency).toBe(Currency.USD);
  expect((await wallet(riderId, 'USD')).balance.toFixed(2)).toBe('-2.00');
  expect((await wallet(riderId, 'ZWG')).balance.toFixed(2)).toBe('4.00');
});

it('credits a verified payment only to the wallet of that currency', async () => {
  const riderId = await createRider('1.00', '0.00');
  const usd = await verifiedPayment(riderId, 'USD', 250, 'usd-credit');
  const zig = await verifiedPayment(riderId, 'ZWG', 300, 'zig-credit');
  const usdPosted = await postEcocashCredit(prisma, usd.id, evidence(usd, 250, 'USD'), NOW);
  const zigPosted = await postEcocashCredit(prisma, zig.id, evidence(zig, 300, 'ZWG'), NOW);
  expect(usdPosted.credited).toBe(true);
  expect(zigPosted).toMatchObject({ credited: true, balance: '3.00' });
  expect((await wallet(riderId, 'USD')).balance.toFixed(2)).toBe('3.50');
  expect((await wallet(riderId, 'ZWG')).balance.toFixed(2)).toBe('3.00');
  const usdEntry = await prisma.riderWalletEntry.findFirstOrThrow({ where: { walletPaymentId: usd.id } });
  const zigEntry = await prisma.riderWalletEntry.findFirstOrThrow({ where: { walletPaymentId: zig.id } });
  expect(usdEntry.currency).toBe(Currency.USD);
  expect(zigEntry.currency).toBe(Currency.ZWG);
  expect(await prisma.walletPaymentException.count({ where: { walletPaymentId: zig.id } })).toBe(0);
});

it('credits one verified ZiG callback and ignores the duplicate', async () => {
  const riderId = await createRider('0.00', '0.00');
  const payment = await verifiedPayment(riderId, 'ZWG', 250, 'once');
  const transaction = evidence(payment, 250, 'ZWG');
  const [first, second] = await Promise.all([
    postEcocashCredit(prisma, payment.id, transaction, NOW),
    postEcocashCredit(prisma, payment.id, transaction, NOW),
  ]);
  expect([first, second].filter((result) => result.credited)).toHaveLength(2);
  expect([first, second].filter((result) => result.replayed)).toHaveLength(1);
  expect((await wallet(riderId, 'ZWG')).balance.toFixed(2)).toBe('2.50');
  expect(await prisma.riderWalletEntry.count({
    where: { riderWalletId: (await wallet(riderId, 'ZWG')).id, entryType: WalletEntryType.TOP_UP },
  })).toBe(1);
});

it('does not credit a refunded or reversed ZiG payment', async () => {
  const riderId = await createRider('0.00', '1.00');
  const refunded = await verifiedPayment(riderId, 'ZWG', 250, 'refunded', WalletPaymentStatus.REFUNDED);
  const reversed = await verifiedPayment(riderId, 'ZWG', 250, 'reversed', WalletPaymentStatus.REVERSED);
  expect((await postEcocashCredit(prisma, refunded.id, evidence(refunded, 250, 'ZWG'), NOW)).credited).toBe(false);
  expect((await postEcocashCredit(prisma, reversed.id, evidence(reversed, 250, 'ZWG'), NOW)).credited).toBe(false);
  expect((await wallet(riderId, 'ZWG')).balance.toFixed(2)).toBe('1.00');
  expect(await prisma.riderWalletEntry.count({ where: { walletPaymentId: { in: [refunded.id, reversed.id] } } })).toBe(0);
});

it('credits a ZiG payment that succeeds after USD debt appears and flags it', async () => {
  const riderId = await createRider('-8.00', '0.00');
  const payment = await verifiedPayment(riderId, 'ZWG', 400, 'late');
  const posted = await postEcocashCredit(prisma, payment.id, evidence(payment, 400, 'ZWG'), NOW);
  await postEcocashCredit(prisma, payment.id, evidence(payment, 400, 'ZWG'), NOW);
  expect(posted.credited).toBe(true);
  expect((await wallet(riderId, 'ZWG')).balance.toFixed(2)).toBe('4.00');
  expect((await wallet(riderId, 'USD')).balance.toFixed(2)).toBe('-8.00');
  const flagged = await prisma.walletPaymentException.findMany({ where: { walletPaymentId: payment.id } });
  expect(flagged).toEqual([expect.objectContaining({ code: USD_DEBT_AFTER_ZWG_PAYMENT })]);
  expect(flagged[0]!.usdBalance.toFixed(2)).toBe('-8.00');
  await expect(start(riderId, 'ZWG', 'still-blocked')).rejects.toBeInstanceOf(ConflictException);
});

async function start(riderId: string, currency: 'USD' | 'ZWG', key: string) {
  return initiateEcocashTopUp(
    prisma,
    provider,
    { userId: 'unused', riderProfileId: riderId },
    { amount: '2.50', currency, endUserId: '0771300001' },
    `${key}-${riderId}`,
    NOW,
  );
}

async function verifiedPayment(
  riderId: string,
  currency: 'USD' | 'ZWG',
  amountCents: number,
  key: string,
  status: WalletPaymentStatus = WalletPaymentStatus.VERIFIED,
) {
  const owned = await wallet(riderId, currency);
  paymentSequence += 1;
  const reference = `MP${String(paymentSequence).padStart(8, '0')}`;
  const correlator = String(3000000000000000 + paymentSequence);
  return prisma.walletPayment.create({
    data: {
      riderWalletId: owned.id,
      method: WalletPaymentMethod.GATEWAY,
      status,
      amount: (amountCents / 100).toFixed(2),
      currency,
      provider: 'ECOCASH',
      providerTransactionId: reference,
      ecocashReference: reference,
      idempotencyKey: `pay-${key}-${paymentSequence}`,
      payloadHash: 'b'.repeat(64),
      payerMsisdn: '771300001',
      clientCorrelator: correlator,
      referenceCode: `RDR${correlator}`,
      lastProviderResponseCode: '00',
      verifiedAt: status === WalletPaymentStatus.VERIFIED ? NOW : null,
      chargeAttemptedAt: NOW,
    },
  });
}

function evidence(
  payment: { clientCorrelator: string | null; referenceCode: string | null; payerMsisdn: string | null; providerTransactionId: string | null },
  amountCents: number,
  currency: 'USD' | 'ZWG',
) {
  return {
    clientCorrelator: payment.clientCorrelator ?? '',
    referenceCode: payment.referenceCode ?? '',
    endUserId: payment.payerMsisdn ?? '',
    ecocashReference: payment.providerTransactionId,
    transactionOperationStatus: 'Charged',
    responseCode: '00',
    amountCents,
    currency,
  };
}

async function createRider(usd: string, zig: string) {
  const user = await prisma.user.create({
    data: { fullName: 'Rider', phone: nextPhone(), role: UserRole.RIDER, accountStatus: 'ACTIVE', phoneVerifiedAt: NOW },
  });
  const profile = await prisma.riderProfile.create({
    data: {
      userId: user.id,
      verificationStatus: 'VERIFIED',
      approvalStatus: 'APPROVED',
      availability: 'AVAILABLE',
      receivingRequests: true,
    },
  });
  const usdWallet = await prisma.riderWallet.create({
    data: { riderProfileId: profile.id, currency: 'USD', balance: usd },
  });
  await prisma.riderWallet.create({
    data: { riderProfileId: profile.id, currency: 'ZWG', balance: zig, welcomeBonusAwardedAt: NOW },
  });
  if (usd !== '0.00') {
    await prisma.riderWalletEntry.create({
      data: {
        riderWalletId: usdWallet.id,
        entryType: WalletEntryType.ADJUSTMENT,
        amount: usd,
        balanceAfter: usd,
        currency: Currency.USD,
        configVersion: 1,
        idempotencyKey: `opening-${usdWallet.id}`,
        payloadHash: 'a'.repeat(64),
        reason: 'Opening test balance',
        actorType: 'ADMIN',
        actorId: (await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } })).id,
      },
    });
  }
  return profile.id;
}

function wallet(riderId: string, currency: 'USD' | 'ZWG') {
  return prisma.riderWallet.findUniqueOrThrow({
    where: { riderProfileId_currency: { riderProfileId: riderId, currency } },
  });
}

function nextPhone(): string {
  phone += 1;
  return `+263${phone}`;
}

async function waitForPostgres() {
  let lastError: unknown;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const client = new pg.Client({ connectionString: DISPOSABLE_URL, connectionTimeoutMillis: 1000 });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}
