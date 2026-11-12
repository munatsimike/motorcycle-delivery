import { execFile } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AccessTokenService } from '../auth/access-token.service.js';
import { RiderAccessGuard } from '../auth/rider-access.guard.js';
import { RiderAccessService } from '../auth/rider-access.service.js';
import { PrismaClient, WalletPaymentStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EcocashPaymentProvider, type EcocashChargeRequest, type EcocashProviderResult, type EcocashTransaction } from './ecocash-client.js';
import { reconcileEcocashTopUps, lookupEcocashTopUp, type PrismaClientLike } from './ecocash-top-up.js';
import { postEcocashCredit, reconcileUncreditedEcocashCredits, type EcocashCreditClient } from './ecocash-credit.js';
import { signedCentsFromDecimal } from './wallet-money.js';
import { EcocashTopUpController } from './ecocash-top-up.controller.js';
import { EcocashTopUpService } from './ecocash-top-up.service.js';

const exec = promisify(execFile);
const HOST = '127.0.0.1';
const PORT = 54358;
const DATABASE = 'ecocash_phase1';
const CONTAINER = 'riders-ecocash-phase1-pg';
const DISPOSABLE_URL = `postgresql://postgres:postgres@${HOST}:${PORT}/${DATABASE}`;
const BACKEND = resolve(import.meta.dirname, '../..');
const USER_A = '00000000-0000-7000-8000-0000000000a1';
const USER_B = '00000000-0000-7000-8000-0000000000b1';
const USER_C = '00000000-0000-7000-8000-0000000000c1';
const ADMIN = '00000000-0000-7000-8000-0000000000ad';
const PROFILE_A = '00000000-0000-7000-8000-0000000000aa';
const PROFILE_B = '00000000-0000-7000-8000-0000000000bb';
const SESSION_A = '00000000-0000-7000-8000-0000000000c1';
const SESSION_B = '00000000-0000-7000-8000-0000000000c2';
const SESSION_C = '00000000-0000-7000-8000-0000000000c3';
const FAMILY_A = '00000000-0000-7000-8000-0000000000f1';
const FAMILY_B = '00000000-0000-7000-8000-0000000000f2';
const FAMILY_C = '00000000-0000-7000-8000-0000000000f3';
const SECRET = '0123456789abcdef0123456789abcdef';

let app: INestApplication;
let prisma: PrismaClient;
let observer: pg.Client;
let devBefore = '';
let devUrl = '';
const savedEnv = new Map<string, string | undefined>();
let provider: ScriptedProvider;

beforeAll(async () => {
  provider = new ScriptedProvider();
  devUrl = configuredDatabaseUrl();
  assertDevelopmentDatabase(devUrl);
  devBefore = await checksum(devUrl);
  assertDisposable(DISPOSABLE_URL);
  await exec('docker', ['rm', '-f', CONTAINER], { windowsHide: true }).catch(() => undefined);
  await exec('docker', [
    'run', '-d', '--name', CONTAINER,
    '--publish', `${HOST}:${PORT}:5432`,
    '--env', 'POSTGRES_PASSWORD=postgres',
    '--env', `POSTGRES_DB=${DATABASE}`,
    'postgis/postgis:17-3.5',
  ], { windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
  observer = await waitForPostgres();
  const hosted = await observer.query("SELECT nspname FROM pg_namespace WHERE nspname IN ('auth', 'storage', 'supabase_migrations')");
  if (hosted.rows.length > 0) {
    throw new Error('Refusing a database that already contains hosted Supabase schemas');
  }
  const identity = await observer.query('SELECT current_database() AS database');
  if (identity.rows[0]?.database !== DATABASE) {
    throw new Error('Disposable database identity did not match');
  }
  rememberEnv();
  process.env.DATABASE_URL = DISPOSABLE_URL;
  process.env.DATABASE_SSL_CA = '';
  process.env.NODE_ENV = 'development';
  process.env.JWT_ACCESS_SECRET = SECRET;
  process.env.ECOCASH_ENABLED = 'true';
  process.env.ECOCASH_ENVIRONMENT = 'sandbox';
  process.env.ECOCASH_SANDBOX_BASE_URL = 'https://developers.ecocash.co.zw';
  process.env.ECOCASH_USERNAME = 'sandbox-user';
  process.env.ECOCASH_PASSWORD = 'sandbox-pass';
  process.env.ECOCASH_MERCHANT_CODE = 'ABC123';
  process.env.ECOCASH_MERCHANT_NUMBER = '771234567';
  process.env.ECOCASH_MERCHANT_PIN = '2468';
  process.env.ECOCASH_TERMINAL_ID = 'TERM01';
  process.env.ECOCASH_LOCATION = 'Harare';
  process.env.ECOCASH_SUPER_MERCHANT_NAME = 'Riders';
  process.env.ECOCASH_MERCHANT_NAME = 'Riders';
  process.env.ECOCASH_PURCHASE_CATEGORY = 'Online Payment';
  process.env.ECOCASH_CHARGE_DESCRIPTION = 'Riders wallet top-up';
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('RAILWAY_')) delete process.env[key];
  }
  delete process.env.TRUST_RAILWAY_EDGE_CLIENT_IP;
  await applyMigrations(observer);
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DISPOSABLE_URL }) });
  await prisma.$connect();
  await seed();
  const moduleRef = await Test.createTestingModule({
    controllers: [EcocashTopUpController],
    providers: [
      EcocashTopUpService,
      RiderAccessGuard,
      RiderAccessService,
      AccessTokenService,
      { provide: PrismaService, useValue: prisma },
      { provide: EcocashPaymentProvider, useValue: provider },
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  await app.listen(0, '127.0.0.1');
}, 300_000);

afterAll(async () => {
  await app?.close().catch(() => undefined);
  await prisma?.$disconnect().catch(() => undefined);
  await observer?.end().catch(() => undefined);
  await exec('docker', ['rm', '-f', CONTAINER], { windowsHide: true }).catch(() => undefined);
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (devUrl) {
    const after = await checksum(devUrl);
    if (after !== devBefore) {
      throw new Error('Development database checksum changed during EcoCash tests');
    }
  }
}, 60_000);

it('creates one pending payment for the authenticated rider and does not credit the wallet', async () => {
  const before = await financialSnapshot();
  provider.use(charged());
  let visibleDuringCharge = false;
  provider.onCharge = async () => {
    const rows = await observer.query('SELECT status, charge_attempted_at FROM wallet_payments WHERE provider = $1', ['ECOCASH']);
    visibleDuringCharge = rows.rows.length === 1 && rows.rows[0]?.charge_attempted_at !== null;
  };
  const response = await request(app.getHttpServer())
    .post('/riders/me/wallet/ecocash-top-ups')
    .set('authorization', await token(USER_A, 'RIDER', SESSION_A))
    .set('idempotency-key', 'top-up-1')
    .send({ amount: '2.50', currency: 'USD', endUserId: '0771234567' });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    status: 'PENDING',
    amountCents: 250,
    currency: 'USD',
    payerMsisdn: '771234567',
    credited: false,
    replayed: false,
  });
  expect(visibleDuringCharge).toBe(true);
  expect(provider.charges).toBe(1);
  const stored = await prisma.walletPayment.findUnique({
    where: { id: response.body.paymentId },
    include: { riderWallet: true, entry: true },
  });
  expect(stored?.riderWallet.riderProfileId).toBe(PROFILE_A);
  expect(stored?.clientCorrelator).toMatch(/^[0-9]{16}$/);
  expect(stored?.referenceCode).toBe(`RDR${stored?.clientCorrelator}`);
  expect(stored?.entry).toBeNull();
  expect(await financialSnapshot()).toBe(before);
});

it('rejects a missing key, an invalid number, and a non-positive amount before any charge', async () => {
  provider.reset(charged());
  const missing = await request(app.getHttpServer())
    .post('/riders/me/wallet/ecocash-top-ups')
    .set('authorization', await token(USER_A, 'RIDER', SESSION_A))
    .send({ amount: '2.50', endUserId: '0771234567' });
  const invalidNumber = await request(app.getHttpServer())
    .post('/riders/me/wallet/ecocash-top-ups')
    .set('authorization', await token(USER_A, 'RIDER', SESSION_A))
    .set('idempotency-key', 'bad-number')
    .send({ amount: '2.50', endUserId: '123' });
  const zero = await request(app.getHttpServer())
    .post('/riders/me/wallet/ecocash-top-ups')
    .set('authorization', await token(USER_A, 'RIDER', SESSION_A))
    .set('idempotency-key', 'zero')
    .send({ amount: '0.00', endUserId: '0771234567' });
  const wrongCurrency = await request(app.getHttpServer())
    .post('/riders/me/wallet/ecocash-top-ups')
    .set('authorization', await token(USER_A, 'RIDER', SESSION_A))
    .set('idempotency-key', 'zwg')
    .send({ amount: '2.50', currency: 'ZWG', endUserId: '0771234567' });
  expect(missing.status).toBe(400);
  expect(invalidNumber.status).toBe(400);
  expect(zero.status).toBe(400);
  expect(wrongCurrency.status).toBe(400);
  expect(provider.charges).toBe(0);
  expect(JSON.stringify([missing.body, invalidNumber.body, zero.body, wrongCurrency.body])).not.toContain('sandbox-pass');
});

it('replays the same key and rejects a changed payload, another rider, or a second open payment', async () => {
  provider.reset(charged());
  const open = await prisma.walletPayment.findFirstOrThrow({
    where: { riderWallet: { riderProfileId: PROFILE_A }, status: 'PENDING' },
  });
  const retry = await postTopUp(USER_A, SESSION_A, 'RIDER', 'top-up-1', { amount: '2.50', endUserId: '0771234567' });
  const changed = await postTopUp(USER_A, SESSION_A, 'RIDER', 'top-up-1', { amount: '3.00', endUserId: '0771234567' });
  const secondKey = await postTopUp(USER_A, SESSION_A, 'RIDER', 'second-open', { amount: '1.00', endUserId: '0771234567' });
  const otherRider = await postTopUp(USER_B, SESSION_B, 'RIDER', 'top-up-1', { amount: '2.50', endUserId: '0771234567' });
  expect(retry.status).toBe(200);
  expect(retry.body.paymentId).toBe(open.id);
  expect(retry.body.replayed).toBe(true);
  expect(changed.status).toBe(409);
  expect(secondKey.status).toBe(409);
  expect(otherRider.status).toBe(409);
  expect(provider.charges).toBe(0);
  const lookup = await request(app.getHttpServer())
    .post(`/riders/me/wallet/ecocash-top-ups/${open.id}/lookup`)
    .set('authorization', await token(USER_B, 'RIDER', SESSION_B));
  expect(lookup.status).toBe(404);
  expect(JSON.stringify(lookup.body)).not.toContain(open.clientCorrelator);
});

it('allows one charge when the same key or two keys race', async () => {
  provider.reset(charged());
  const sameKey = await Promise.all([
    postTopUp(USER_B, SESSION_B, 'RIDER', 'race-same', { amount: '1.50', endUserId: '0771234567' }),
    postTopUp(USER_B, SESSION_B, 'RIDER', 'race-same', { amount: '1.50', endUserId: '0771234567' }),
  ]);
  expect(sameKey.every((response) => response.status === 200)).toBe(true);
  expect(new Set(sameKey.map((response) => response.body.paymentId)).size).toBe(1);
  await releaseWallet(PROFILE_B);
  provider.reset(charged());
  const differentKeys = await Promise.allSettled([
    postTopUp(USER_B, SESSION_B, 'RIDER', 'race-a', { amount: '4.00', endUserId: '0771234567' }),
    postTopUp(USER_B, SESSION_B, 'RIDER', 'race-b', { amount: '4.00', endUserId: '0771234567' }),
  ]);
  const fulfilled = differentKeys.filter((result) => result.status === 'fulfilled').map((result) => result.value);
  expect(differentKeys.every((result) => result.status === 'fulfilled')).toBe(true);
  expect(fulfilled.every((response) => response.status === 200)).toBe(true);
  expect(new Set(fulfilled.map((response) => response.body.paymentId)).size).toBe(1);
  const rows = await prisma.walletPayment.count({
    where: { riderWallet: { riderProfileId: PROFILE_B }, status: { in: ['PENDING', 'UNRESOLVED'] } },
  });
  expect(rows).toBe(1);
  expect(provider.charges).toBe(1);
  const changedAmount = await postTopUp(USER_B, SESSION_B, 'RIDER', 'race-c', { amount: '5.00', endUserId: '0771234567' });
  expect(changedAmount.status).toBe(409);
  expect(provider.charges).toBe(1);
  await releaseWallet(PROFILE_B);
  provider.reset(charged());
  const mixed = await Promise.all([
    postTopUp(USER_B, SESSION_B, 'RIDER', 'race-d', { amount: '6.00', endUserId: '0771234567' }),
    postTopUp(USER_B, SESSION_B, 'RIDER', 'race-e', { amount: '7.00', endUserId: '0771234567' }),
  ]);
  expect(mixed.map((response) => response.status).sort()).toEqual([200, 409]);
  expect(provider.charges).toBe(1);
  await releaseWallet(PROFILE_A);
  await releaseWallet(PROFILE_B);
  provider.reset(charged());
  const sharedKey = await Promise.all([
    postTopUp(USER_A, SESSION_A, 'RIDER', 'shared-key', { amount: '1.00', endUserId: '0771234567' }),
    postTopUp(USER_B, SESSION_B, 'RIDER', 'shared-key', { amount: '1.00', endUserId: '0771234567' }),
  ]);
  expect(sharedKey.map((response) => response.status).sort()).toEqual([200, 409]);
  expect(provider.charges).toBe(1);
  expect(JSON.stringify(sharedKey.map((response) => response.body))).not.toMatch(/25P02|prisma|sandbox-pass|2468/i);
  const sharedRows = await prisma.walletPayment.count({ where: { idempotencyKey: 'shared-key' } });
  expect(sharedRows).toBe(1);
});

it('does not send a second charge after a timeout, an HTTP 500, or a crash once the attempt is recorded', async () => {
  await releaseWallet(PROFILE_A);
  const before = await financialSnapshot();
  provider.reset({ kind: 'uncertain', reason: 'timeout' });
  const timedOut = await postTopUp(USER_A, SESSION_A, 'RIDER', 'timeout-1', { amount: '1.25', endUserId: '0771234567' });
  expect(timedOut.body.status).toBe('PENDING');
  const retry = await postTopUp(USER_A, SESSION_A, 'RIDER', 'timeout-1', { amount: '1.25', endUserId: '0771234567' });
  expect(retry.body.paymentId).toBe(timedOut.body.paymentId);
  expect(provider.charges).toBe(1);
  await releaseWallet(PROFILE_A);
  provider.reset({ kind: 'uncertain', reason: 'unavailable' });
  const serverError = await postTopUp(USER_A, SESSION_A, 'RIDER', 'server-1', { amount: '1.25', endUserId: '0771234567' });
  const serverRetry = await postTopUp(USER_A, SESSION_A, 'RIDER', 'server-1', { amount: '1.25', endUserId: '0771234567' });
  expect(serverError.body.status).toBe('PENDING');
  expect(serverRetry.body.replayed).toBe(true);
  expect(provider.charges).toBe(1);
  await releaseWallet(PROFILE_A);
  provider.reset({ kind: 'uncertain', reason: 'timeout' });
  provider.throwOnCharge = true;
  const crashed = await postTopUp(USER_A, SESSION_A, 'RIDER', 'crash-1', { amount: '1.25', endUserId: '0771234567' });
  expect(crashed.status).toBe(200);
  expect(crashed.body.status).toBe('PENDING');
  provider.throwOnCharge = false;
  const afterCrash = await postTopUp(USER_A, SESSION_A, 'RIDER', 'crash-1', { amount: '1.25', endUserId: '0771234567' });
  expect(afterCrash.body.paymentId).toBe(crashed.body.paymentId);
  expect(provider.charges).toBe(1);
  const claimed = await prisma.walletPayment.findUniqueOrThrow({ where: { id: crashed.body.paymentId } });
  expect(claimed.chargeAttemptedAt).not.toBeNull();
  expect(await financialSnapshot()).toBe(before);
});

it('looks up a charged payment without crediting and keeps ownership', async () => {
  await releaseWallet(PROFILE_A);
  const before = await financialSnapshot();
  provider.reset(charged());
  const started = await postTopUp(USER_A, SESSION_A, 'RIDER', 'lookup-1', { amount: '2.00', endUserId: '0771234567' });
  provider.reset(charged(started.body.clientCorrelator, started.body.referenceCode, started.body.providerReference, 200, 'USD'));
  const lookedUp = await request(app.getHttpServer())
    .post(`/riders/me/wallet/ecocash-top-ups/${started.body.paymentId}/lookup`)
    .set('authorization', await token(USER_A, 'RIDER', SESSION_A));
  expect(lookedUp.status).toBe(200);
  expect(lookedUp.body).toMatchObject({ status: 'VERIFIED', credited: false, providerReference: started.body.providerReference });
  const again = await request(app.getHttpServer())
    .post(`/riders/me/wallet/ecocash-top-ups/${started.body.paymentId}/lookup`)
    .set('authorization', await token(USER_A, 'RIDER', SESSION_A));
  expect(again.body.status).toBe('VERIFIED');
  expect(provider.lookups).toBe(1);
  const entry = await prisma.riderWalletEntry.count({ where: { walletPaymentId: started.body.paymentId } });
  expect(entry).toBe(0);
  expect(await financialSnapshot()).toBe(before);
});

it('does not let a later decline overwrite a verified lookup that was already stored', async () => {
  await releaseWallet(PROFILE_A);
  provider.reset(charged());
  const started = await postTopUp(USER_A, SESSION_A, 'RIDER', 'stale-1', { amount: '2.00', endUserId: '0771234567' });
  provider.blockLookups = true;
  const first = request(app.getHttpServer())
    .post(`/riders/me/wallet/ecocash-top-ups/${started.body.paymentId}/lookup`)
    .set('authorization', await token(USER_A, 'RIDER', SESSION_A));
  const second = request(app.getHttpServer())
    .post(`/riders/me/wallet/ecocash-top-ups/${started.body.paymentId}/lookup`)
    .set('authorization', await token(USER_A, 'RIDER', SESSION_A));
  const pending = Promise.all([first, second]);
  await waitFor(() => provider.blocks.length === 2);
  provider.blocks[0]?.(charged(started.body.clientCorrelator, started.body.referenceCode, started.body.providerReference, 200, 'USD'));
  await waitFor(async () => (await prisma.walletPayment.findUnique({ where: { id: started.body.paymentId } }))?.status === WalletPaymentStatus.VERIFIED);
  provider.blocks[1]?.({ kind: 'declined', httpStatus: 422, responseCode: '05' });
  await pending;
  const stored = await prisma.walletPayment.findUnique({ where: { id: started.body.paymentId } });
  expect(stored?.status).toBe(WalletPaymentStatus.VERIFIED);
}, 20_000);

it('rejects unauthenticated, expired, and customer requests', async () => {
  const open = await request(app.getHttpServer())
    .post('/riders/me/wallet/ecocash-top-ups')
    .send({ amount: '1.00', endUserId: '0771234567' });
  const expired = await request(app.getHttpServer())
    .post('/riders/me/wallet/ecocash-top-ups')
    .set('authorization', await token(USER_A, 'RIDER', SESSION_A, -2_000))
    .set('idempotency-key', 'expired')
    .send({ amount: '1.00', endUserId: '0771234567' });
  const customer = await postTopUp(USER_C, SESSION_C, 'CUSTOMER', 'customer-1', { amount: '1.00', endUserId: '0771234567' });
  const malformed = await request(app.getHttpServer())
    .post('/riders/me/wallet/ecocash-top-ups/not-a-uuid/lookup')
    .set('authorization', await token(USER_A, 'RIDER', SESSION_A));
  expect(open.status).toBe(401);
  expect(expired.status).toBe(401);
  expect(customer.status).toBe(403);
  expect(malformed.status).toBe(400);
  expect(JSON.stringify([open.body, expired.body, customer.body, malformed.body])).not.toMatch(/prisma|sandbox-pass|2468/i);
});

it('does not let expiry conceal a later confirmed charge', async () => {
  await releaseWallet(PROFILE_A);
  provider.reset({ kind: 'not_found' });
  const started = await postTopUp(USER_A, SESSION_A, 'RIDER', 'expired-1', { amount: '1.10', endUserId: '0771234567' });
  await prisma.walletPayment.update({
    where: { id: started.body.paymentId },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  const expired = await request(app.getHttpServer())
    .post(`/riders/me/wallet/ecocash-top-ups/${started.body.paymentId}/lookup`)
    .set('authorization', await token(USER_A, 'RIDER', SESSION_A));
  expect(expired.body.status).toBe('EXPIRED');
  provider.reset(charged(started.body.clientCorrelator, started.body.referenceCode));
  const lateMissing = await request(app.getHttpServer())
    .post(`/riders/me/wallet/ecocash-top-ups/${started.body.paymentId}/lookup`)
    .set('authorization', await token(USER_A, 'RIDER', SESSION_A));
  expect(lateMissing.body.status).toBe('UNRESOLVED');
  expect(lateMissing.body.credited).toBe(false);
  const stored = await prisma.walletPayment.findUniqueOrThrow({ where: { id: started.body.paymentId } });
  expect(stored.lastProviderResponseCode).toBe('AMOUNT_CURRENCY_UNVERIFIED');
  provider.reset(charged(started.body.clientCorrelator, started.body.referenceCode, stored.providerTransactionId ?? 'MP-LOOKUP', 110, 'USD'));
  const late = await request(app.getHttpServer())
    .post(`/riders/me/wallet/ecocash-top-ups/${started.body.paymentId}/lookup`)
    .set('authorization', await token(USER_A, 'RIDER', SESSION_A));
  expect(late.body.status).toBe('VERIFIED');
  expect(late.body.credited).toBe(false);
  expect(provider.charges).toBe(0);
  expect(provider.lookups).toBe(1);
});

it('recovers a failed payment from a later complete charge without posting another charge', async () => {
  await releaseWallet(PROFILE_A);
  const before = await financialSnapshot();
  provider.reset({ kind: 'declined', httpStatus: 422, responseCode: '05' });
  const started = await postTopUp(USER_A, SESSION_A, 'RIDER', 'failed-recover', { amount: '1.40', endUserId: '0771234567' });
  expect(started.body.status).toBe('FAILED');
  provider.reset(charged(started.body.clientCorrelator, started.body.referenceCode, 'MP-LATE', 140, 'USD'));
  const recovered = await request(app.getHttpServer())
    .post(`/riders/me/wallet/ecocash-top-ups/${started.body.paymentId}/lookup`)
    .set('authorization', await token(USER_A, 'RIDER', SESSION_A));
  expect(recovered.body).toMatchObject({ status: 'VERIFIED', credited: false });
  expect(provider.charges).toBe(0);
  expect(provider.lookups).toBe(1);
  expect(await financialSnapshot()).toBe(before);
});

it('reconciles a claimed payment by lookup and does not send another charge', async () => {
  await releaseWallet(PROFILE_A);
  const before = await financialSnapshot();
  provider.reset({ kind: 'uncertain', reason: 'timeout' });
  const started = await postTopUp(USER_A, SESSION_A, 'RIDER', 'reconcile-1', { amount: '1.25', endUserId: '0771234567' });
  await prisma.walletPayment.update({
    where: { id: started.body.paymentId },
    data: { nextLookupAt: new Date(Date.now() - 1000) },
  });
  provider.reset(charged(started.body.clientCorrelator, started.body.referenceCode, 'MP-RECON', 125, 'USD'));
  const processed = await Promise.all([
    reconcileEcocashTopUps(prisma as unknown as PrismaClientLike, provider),
    reconcileEcocashTopUps(prisma as unknown as PrismaClientLike, provider),
  ]);
  expect(processed.reduce((sum, count) => sum + count, 0)).toBe(1);
  expect(provider.charges).toBe(0);
  expect(provider.lookups).toBe(1);
  const stored = await prisma.walletPayment.findUniqueOrThrow({ where: { id: started.body.paymentId } });
  expect(stored.status).toBe(WalletPaymentStatus.VERIFIED);
  expect(await prisma.riderWalletEntry.count({ where: { walletPaymentId: stored.id } })).toBe(0);
  expect(await financialSnapshot()).toBe(before);
});

it('ignores a client attempt to set status, provider reference, or credited', async () => {
  await releaseWallet(PROFILE_A);
  provider.reset(charged());
  const response = await postTopUp(USER_A, SESSION_A, 'RIDER', 'forged-1', {
    amount: '1.00',
    endUserId: '0771234567',
    status: 'VERIFIED',
    credited: true,
    providerTransactionId: 'MP-FORGED',
    walletId: PROFILE_B,
  });
  expect(response.status).toBe(200);
  expect(response.body.status).toBe('PENDING');
  expect(response.body.credited).toBe(false);
  expect(response.body.providerReference).not.toBe('MP-FORGED');
  const stored = await prisma.walletPayment.findUnique({ where: { id: response.body.paymentId }, include: { riderWallet: true } });
  expect(stored?.riderWallet.riderProfileId).toBe(PROFILE_A);
  expect(stored?.providerTransactionId).toBe(response.body.providerReference);
  expect(stored?.providerTransactionId).not.toBe('MP-FORGED');
});

it('keeps admin receipts unchanged and enforces the payment unique indexes', async () => {
  await releaseWallet(PROFILE_A);
  await releaseWallet(PROFILE_B);
  const before = await financialSnapshot();
  const adminBefore = await prisma.walletPayment.findMany({
    where: { method: { in: ['CASH', 'ECOCASH'] } },
    orderBy: { id: 'asc' },
  });
  provider.reset(charged());
  const created = await postTopUp(USER_A, SESSION_A, 'RIDER', 'unique-1', { amount: '1.00', endUserId: '0771234567' });
  const stored = await prisma.walletPayment.findUniqueOrThrow({ where: { id: created.body.paymentId } });
  const walletB = await prisma.riderWallet.findUniqueOrThrow({ where: { riderProfileId: PROFILE_B } });
  await expect(observer.query(duplicatePaymentSql('client'), [
    walletB.id, 'unique-correlator', 'b'.repeat(64), stored.clientCorrelator, 'RDR3234567890123456',
  ])).rejects.toMatchObject({ code: '23505', constraint: 'wallet_payments_client_correlator_key' });
  await expect(observer.query(duplicatePaymentSql('reference'), [
    walletB.id, 'unique-reference', 'c'.repeat(64), '3234567890123456', stored.referenceCode,
  ])).rejects.toMatchObject({ code: '23505', constraint: 'wallet_payments_reference_code_key' });
  await expect(observer.query(duplicatePaymentSql('idempotency'), [
    walletB.id, stored.idempotencyKey, 'd'.repeat(64), '4234567890123456', 'RDR4234567890123456',
  ])).rejects.toMatchObject({ code: '23505', constraint: 'wallet_payments_idempotency_key_key' });
  await expect(observer.query(duplicatePaymentSql('pending'), [
    stored.riderWalletId, 'unique-pending', 'e'.repeat(64), '5234567890123456', 'RDR5234567890123456',
  ])).rejects.toMatchObject({ code: '23505', constraint: 'wallet_payments_one_unresolved_idx' });
  provider.lookupQueue.push(charged(stored.clientCorrelator ?? '', stored.referenceCode ?? '', 'MP-ADMIN'));
  const collided = await request(app.getHttpServer())
    .post(`/riders/me/wallet/ecocash-top-ups/${stored.id}/lookup`)
    .set('authorization', await token(USER_A, 'RIDER', SESSION_A));
  expect(JSON.stringify(collided.body)).not.toMatch(/prisma|P2002|sandbox-pass|2468/i);
  const adminAfter = await prisma.walletPayment.findMany({
    where: { method: { in: ['CASH', 'ECOCASH'] } },
    orderBy: { id: 'asc' },
  });
  expect(adminAfter).toEqual(adminBefore);
  expect(await financialSnapshot()).toBe(before);
});

it('credits one verified payment from provider evidence and does not credit unresolved evidence', async () => {
  await releaseWallet(PROFILE_A);
  provider.reset(charged());
  const unresolved = await postTopUp(USER_A, SESSION_A, 'RIDER', 'credit-missing', { amount: '1.10', endUserId: '0771234567' });
  const storedUnresolved = await prisma.walletPayment.findUniqueOrThrow({ where: { id: unresolved.body.paymentId } });
  provider.lookupQueue.push(charged(storedUnresolved.clientCorrelator ?? '', storedUnresolved.referenceCode ?? '', storedUnresolved.providerTransactionId, null, null));
  const lookedUp = await request(app.getHttpServer())
    .post(`/riders/me/wallet/ecocash-top-ups/${storedUnresolved.id}/lookup`)
    .set('authorization', await token(USER_A, 'RIDER', SESSION_A));
  expect(lookedUp.body).toMatchObject({ status: 'UNRESOLVED', credited: false });
  const walletBefore = await prisma.riderWallet.findUniqueOrThrow({ where: { riderProfileId: PROFILE_A } });
  const refused = await postEcocashCredit(
    prisma as unknown as EcocashCreditClient,
    storedUnresolved.id,
    evidence(storedUnresolved, 110, 'USD'),
  );
  expect(refused.credited).toBe(false);
  expect(await prisma.walletPayment.findUnique({ where: { id: storedUnresolved.id } })).toMatchObject({ status: 'UNRESOLVED' });
  await releaseWallet(PROFILE_A);

  provider.reset(charged());
  const started = await postTopUp(USER_A, SESSION_A, 'RIDER', 'credit-verified', { amount: '2.00', endUserId: '0771234567' });
  const pending = await prisma.walletPayment.findUniqueOrThrow({ where: { id: started.body.paymentId } });
  provider.lookupQueue.push(charged(pending.clientCorrelator ?? '', pending.referenceCode ?? '', null, 200, 'USD'));
  const verified = await request(app.getHttpServer())
    .post(`/riders/me/wallet/ecocash-top-ups/${pending.id}/lookup`)
    .set('authorization', await token(USER_A, 'RIDER', SESSION_A));
  expect(verified.body).toMatchObject({ status: 'VERIFIED', credited: false });
  const row = await prisma.walletPayment.findUniqueOrThrow({ where: { id: pending.id } });
  const missing = await postEcocashCredit(prisma as unknown as EcocashCreditClient, row.id, evidence(row, null, null));
  const mismatched = await postEcocashCredit(prisma as unknown as EcocashCreditClient, row.id, evidence(row, 201, 'USD'));
  expect(missing.credited).toBe(false);
  expect(mismatched.credited).toBe(false);
  const first = await postEcocashCredit(prisma as unknown as EcocashCreditClient, row.id, evidence(row, 200, 'USD'));
  const second = await postEcocashCredit(prisma as unknown as EcocashCreditClient, row.id, evidence(row, 200, 'USD'));
  const expectedBalance = ((signedCentsFromDecimal(walletBefore.balance) + 200) / 100).toFixed(2);
  expect(first).toMatchObject({ credited: true, replayed: false, balance: expectedBalance });
  expect(second).toMatchObject({ credited: true, replayed: true, entryId: first.entryId });
  const entries = await prisma.riderWalletEntry.findMany({ where: { walletPaymentId: row.id } });
  expect(entries).toHaveLength(1);
  expect(entries[0]?.entryType).toBe('TOP_UP');
  expect(entries[0]?.actorType).toBe('SYSTEM');
  expect(entries[0]?.actorId).toBeNull();
  expect(signedCentsFromDecimal(entries[0]?.amount ?? '0')).toBe(200);
  const walletAfter = await prisma.riderWallet.findUniqueOrThrow({ where: { riderProfileId: PROFILE_A } });
  expect(walletAfter.balance.toFixed(2)).toBe(expectedBalance);
  expect(walletAfter.promotionalBalance.toFixed(2)).toBe(walletBefore.promotionalBalance.toFixed(2));
  expect(walletAfter.borrowingLimitOverride?.toFixed(2)).toBe(walletBefore.borrowingLimitOverride?.toFixed(2));
  expect(await ledgerMatchesBalance(walletAfter.id)).toBe(true);
  expect(await prisma.walletFeeReservation.count()).toBe(1);
  expect(await prisma.walletPayment.count({ where: { method: { in: ['CASH', 'ECOCASH'] } } })).toBe(2);
  expect(provider.charges).toBe(1);
});

it('posts one credit when lookup is explicitly allowed and a later lookup does not post again', async () => {
  await releaseWallet(PROFILE_A);
  provider.reset(charged());
  const started = await postTopUp(USER_A, SESSION_A, 'RIDER', 'credit-lookup', { amount: '1.50', endUserId: '0771234567' });
  const pending = await prisma.walletPayment.findUniqueOrThrow({ where: { id: started.body.paymentId } });
  const before = await prisma.riderWallet.findUniqueOrThrow({ where: { riderProfileId: PROFILE_A } });
  provider.use(charged(pending.clientCorrelator ?? '', pending.referenceCode ?? '', null, 150, 'USD'));
  const credited = await lookupEcocashTopUp(
    prisma as unknown as PrismaClientLike,
    provider,
    { userId: USER_A, riderProfileId: PROFILE_A },
    pending.id,
    new Date(),
    { credit: true },
  );
  const again = await lookupEcocashTopUp(
    prisma as unknown as PrismaClientLike,
    provider,
    { userId: USER_A, riderProfileId: PROFILE_A },
    pending.id,
    new Date(),
    { credit: true },
  );
  expect(credited).toMatchObject({ status: 'VERIFIED', credited: true, replayed: false });
  expect(again).toMatchObject({ status: 'VERIFIED', credited: true, replayed: true });
  expect(await prisma.riderWalletEntry.count({ where: { walletPaymentId: pending.id } })).toBe(1);
  const after = await prisma.riderWallet.findUniqueOrThrow({ where: { riderProfileId: PROFILE_A } });
  expect(signedDifference(before.balance, after.balance)).toBe(150);
  expect(provider.charges).toBe(1);
  expect(await ledgerMatchesBalance(after.id)).toBe(true);
});

it('recovers a verified uncredited payment once and never sends another charge', async () => {
  await releaseWallet(PROFILE_A);
  provider.reset(charged());
  const started = await postTopUp(USER_A, SESSION_A, 'RIDER', 'credit-recover', { amount: '1.25', endUserId: '0771234567' });
  const pending = await prisma.walletPayment.findUniqueOrThrow({ where: { id: started.body.paymentId } });
  provider.lookupQueue.push(charged(pending.clientCorrelator ?? '', pending.referenceCode ?? '', null, 125, 'USD'));
  const verified = await request(app.getHttpServer())
    .post(`/riders/me/wallet/ecocash-top-ups/${pending.id}/lookup`)
    .set('authorization', await token(USER_A, 'RIDER', SESSION_A));
  expect(verified.body).toMatchObject({ status: 'VERIFIED', credited: false });
  expect(await prisma.riderWalletEntry.count({ where: { walletPaymentId: pending.id } })).toBe(0);
  const charges = provider.charges;
  const lookups = provider.lookups;
  await expect(reconcileUncreditedEcocashCredits(prisma as unknown as EcocashCreditClient, provider)).resolves.toBe(0);
  expect(provider.charges).toBe(charges);
  expect(provider.lookups).toBe(lookups);
  await parkOtherCredits(pending.id);
  provider.lookupQueue.push(charged(pending.clientCorrelator ?? '', pending.referenceCode ?? '', null, null, null));
  expect(await reconcileUncreditedEcocashCredits(prisma as unknown as EcocashCreditClient, provider, new Date(), 20, true)).toBe(0);
  expect(await prisma.walletPayment.findUnique({ where: { id: pending.id } })).toMatchObject({ status: 'VERIFIED' });
  expect(await prisma.riderWalletEntry.count({ where: { walletPaymentId: pending.id } })).toBe(0);
  await prisma.walletPayment.update({ where: { id: pending.id }, data: { nextLookupAt: new Date() } });
  provider.lookupQueue.push(charged(pending.clientCorrelator ?? '', pending.referenceCode ?? '', null, 125, 'USD'));
  provider.lookupQueue.push(charged(pending.clientCorrelator ?? '', pending.referenceCode ?? '', null, 125, 'USD'));
  const recovered = await Promise.all([
    reconcileUncreditedEcocashCredits(prisma as unknown as EcocashCreditClient, provider, new Date(), 20, true),
    reconcileUncreditedEcocashCredits(prisma as unknown as EcocashCreditClient, provider, new Date(), 20, true),
  ]);
  expect(recovered.reduce((sum, count) => sum + count, 0)).toBe(1);
  expect(await prisma.riderWalletEntry.count({ where: { walletPaymentId: pending.id } })).toBe(1);
  expect(provider.charges).toBe(charges);
  const wallet = await prisma.riderWallet.findUniqueOrThrow({ where: { riderProfileId: PROFILE_A } });
  expect(await ledgerMatchesBalance(wallet.id)).toBe(true);
});

it('lets only one of two concurrent credit workers post the ledger entry', async () => {
  await releaseWallet(PROFILE_A);
  provider.reset(charged());
  const started = await postTopUp(USER_A, SESSION_A, 'RIDER', 'credit-race', { amount: '0.80', endUserId: '0771234567' });
  const pending = await prisma.walletPayment.findUniqueOrThrow({ where: { id: started.body.paymentId } });
  provider.lookupQueue.push(charged(pending.clientCorrelator ?? '', pending.referenceCode ?? '', null, 80, 'USD'));
  const verified = await request(app.getHttpServer())
    .post(`/riders/me/wallet/ecocash-top-ups/${pending.id}/lookup`)
    .set('authorization', await token(USER_A, 'RIDER', SESSION_A));
  expect(verified.body.status).toBe('VERIFIED');
  const row = await prisma.walletPayment.findUniqueOrThrow({ where: { id: pending.id } });
  const proof = evidence(row, 80, 'USD');
  const posted = await Promise.all([
    postEcocashCredit(prisma as unknown as EcocashCreditClient, row.id, proof),
    postEcocashCredit(prisma as unknown as EcocashCreditClient, row.id, proof),
  ]);
  expect(posted.filter((result) => result.credited)).toHaveLength(2);
  expect(posted.filter((result) => !result.replayed)).toHaveLength(1);
  expect(await prisma.riderWalletEntry.count({ where: { walletPaymentId: row.id } })).toBe(1);
  const wallet = await prisma.riderWallet.findUniqueOrThrow({ where: { riderProfileId: PROFILE_A } });
  expect(await ledgerMatchesBalance(wallet.id)).toBe(true);
});

it('uses the credit switch only after provider amount and currency evidence', async () => {
  await releaseWallet(PROFILE_A);
  expect(process.env.ECOCASH_AUTO_CREDIT_ENABLED).not.toBe('true');
  provider.reset(charged());
  const missing = await postTopUp(USER_A, SESSION_A, 'RIDER', 'flag-missing', { amount: '0.70', endUserId: '0771234567' });
  const unresolvedRow = await prisma.walletPayment.findUniqueOrThrow({ where: { id: missing.body.paymentId } });
  process.env.ECOCASH_AUTO_CREDIT_ENABLED = 'true';
  try {
    provider.lookupQueue.push(charged(unresolvedRow.clientCorrelator ?? '', unresolvedRow.referenceCode ?? '', null, null, null));
    const unresolved = await request(app.getHttpServer())
      .post(`/riders/me/wallet/ecocash-top-ups/${unresolvedRow.id}/lookup`)
      .set('authorization', await token(USER_A, 'RIDER', SESSION_A));
    expect(unresolved.body).toMatchObject({ status: 'UNRESOLVED', credited: false });
    expect(await prisma.riderWalletEntry.count({ where: { walletPaymentId: unresolvedRow.id } })).toBe(0);
  } finally {
    delete process.env.ECOCASH_AUTO_CREDIT_ENABLED;
  }
  await releaseWallet(PROFILE_A);
  provider.reset(charged());
  const started = await postTopUp(USER_A, SESSION_A, 'RIDER', 'flag-verified', { amount: '0.70', endUserId: '0771234567' });
  const pending = await prisma.walletPayment.findUniqueOrThrow({ where: { id: started.body.paymentId } });
  const before = await prisma.riderWallet.findUniqueOrThrow({ where: { riderProfileId: PROFILE_A } });
  provider.lookupQueue.push(charged(pending.clientCorrelator ?? '', pending.referenceCode ?? '', null, 70, 'USD'));
  const held = await request(app.getHttpServer())
    .post(`/riders/me/wallet/ecocash-top-ups/${pending.id}/lookup`)
    .set('authorization', await token(USER_A, 'RIDER', SESSION_A));
  expect(held.body).toMatchObject({ status: 'VERIFIED', credited: false });
  expect(await prisma.riderWalletEntry.count({ where: { walletPaymentId: pending.id } })).toBe(0);
  process.env.ECOCASH_AUTO_CREDIT_ENABLED = 'true';
  try {
    provider.lookupQueue.push(charged(pending.clientCorrelator ?? '', pending.referenceCode ?? '', null, 70, 'USD'));
    const credited = await request(app.getHttpServer())
      .post(`/riders/me/wallet/ecocash-top-ups/${pending.id}/lookup`)
      .set('authorization', await token(USER_A, 'RIDER', SESSION_A));
    const replayed = await request(app.getHttpServer())
      .post(`/riders/me/wallet/ecocash-top-ups/${pending.id}/lookup`)
      .set('authorization', await token(USER_A, 'RIDER', SESSION_A));
    expect(credited.body).toMatchObject({ status: 'VERIFIED', credited: true });
    expect(replayed.body).toMatchObject({ status: 'VERIFIED', credited: true });
    expect(await prisma.riderWalletEntry.count({ where: { walletPaymentId: pending.id } })).toBe(1);
    const after = await prisma.riderWallet.findUniqueOrThrow({ where: { riderProfileId: PROFILE_A } });
    expect(signedDifference(before.balance, after.balance)).toBe(70);
    expect(await ledgerMatchesBalance(after.id)).toBe(true);
    expect(provider.charges).toBe(1);
  } finally {
    delete process.env.ECOCASH_AUTO_CREDIT_ENABLED;
  }
});

async function waitFor(ready: () => boolean | Promise<boolean>): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 5_000) {
    if (await ready()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error(`Timed out waiting (${provider.lookups} lookups, ${provider.blocks.length} blocked)`);
}

async function postTopUp(
  userId: string,
  sessionId: string,
  role: 'RIDER' | 'CUSTOMER',
  key: string,
  body: Record<string, unknown>,
) {
  return request(app.getHttpServer())
    .post('/riders/me/wallet/ecocash-top-ups')
    .set('authorization', await token(userId, role, sessionId))
    .set('idempotency-key', key)
    .send({ currency: 'USD', ...body });
}

async function token(userId: string, role: 'RIDER' | 'CUSTOMER', sessionId: string, skewSeconds = 0): Promise<string> {
  const tokens = new AccessTokenService();
  const signed = tokens.sign({ sub: userId, role, sid: sessionId }, new Date(Date.now() + skewSeconds * 1000));
  return `Bearer ${signed.token}`;
}

async function financialSnapshot(): Promise<string> {
  const wallets = await prisma.riderWallet.findMany({ orderBy: { id: 'asc' } });
  const entries = await prisma.riderWalletEntry.findMany({ orderBy: { id: 'asc' } });
  const reservations = await prisma.walletFeeReservation.findMany({ orderBy: { id: 'asc' } });
  const limits = await prisma.walletBorrowingLimitAudit.count();
  return JSON.stringify({ wallets, entries, reservations, limits });
}

function evidence(
  row: {
    clientCorrelator: string | null;
    referenceCode: string | null;
    payerMsisdn: string | null;
    providerTransactionId: string | null;
  },
  amountCents: number | null,
  currency: string | null,
) {
  return {
    clientCorrelator: row.clientCorrelator ?? '',
    referenceCode: row.referenceCode ?? '',
    endUserId: row.payerMsisdn ?? '',
    ecocashReference: row.providerTransactionId,
    transactionOperationStatus: 'Charged',
    responseCode: '00',
    amountCents,
    currency,
  };
}

async function parkOtherCredits(paymentId: string): Promise<void> {
  await prisma.walletPayment.updateMany({
    where: { id: { not: paymentId }, method: 'GATEWAY', status: 'VERIFIED', entry: { is: null } },
    data: { nextLookupAt: new Date('2099-01-01T00:00:00.000Z') },
  });
}

async function ledgerMatchesBalance(walletId: string): Promise<boolean> {
  const wallet = await prisma.riderWallet.findUniqueOrThrow({ where: { id: walletId } });
  const entries = await prisma.riderWalletEntry.findMany({ where: { riderWalletId: walletId } });
  const posted = entries.reduce((sum, entry) => sum + signedCentsFromDecimal(entry.amount), 0);
  return posted === signedCentsFromDecimal(wallet.balance);
}

function signedDifference(
  before: { toFixed(digits: number): string },
  after: { toFixed(digits: number): string },
): number {
  return signedCentsFromDecimal(after) - signedCentsFromDecimal(before);
}

async function releaseWallet(riderProfileId: string): Promise<void> {
  await prisma.walletPayment.updateMany({
    where: { riderWallet: { riderProfileId }, status: { in: ['PENDING', 'UNRESOLVED'] } },
    data: { status: WalletPaymentStatus.FAILED },
  });
}

function duplicatePaymentSql(kind: 'client' | 'reference' | 'idempotency' | 'pending'): string {
  const id = {
    client: '00000000-0000-7000-8000-0000000000e1',
    reference: '00000000-0000-7000-8000-0000000000e2',
    idempotency: '00000000-0000-7000-8000-0000000000e3',
    pending: '00000000-0000-7000-8000-0000000000e4',
  }[kind];
  return `INSERT INTO wallet_payments (
    id, rider_wallet_id, method, status, amount, currency, provider, idempotency_key, payload_hash,
    payer_msisdn, client_correlator, reference_code, next_lookup_at, expires_at, updated_at
  ) VALUES (
    '${id}', $1, 'GATEWAY', 'PENDING', 1.00, 'USD', 'ECOCASH',
    $2, $3, '771234567', $4, $5, NOW(), NOW() + INTERVAL '15 minutes', NOW()
  )`;
}

class ScriptedProvider extends EcocashPaymentProvider {
  charges = 0;
  lookups = 0;
  chargeResult: EcocashProviderResult = { kind: 'uncertain', reason: 'timeout' };
  lookupQueue: Array<EcocashProviderResult | Promise<EcocashProviderResult>> = [];
  onCharge: (() => Promise<void>) | null = null;
  throwOnCharge = false;
  blockLookups = false;
  blocks: Array<(result: EcocashProviderResult) => void> = [];
  references = new Map<string, string>();
  serial = 0;

  reset(result: EcocashProviderResult): void {
    this.charges = 0;
    this.lookups = 0;
    this.chargeResult = result;
    this.lookupQueue = [];
    this.onCharge = null;
    this.throwOnCharge = false;
    this.blockLookups = false;
    this.blocks = [];
  }

  use(result: EcocashProviderResult): void {
    this.chargeResult = result;
  }

  async charge(request: EcocashChargeRequest): Promise<EcocashProviderResult> {
    this.charges += 1;
    await this.onCharge?.();
    if (this.throwOnCharge) {
      throw new Error('connection interrupted');
    }
    const aligned = align(this.chargeResult, request);
    if (aligned.kind === 'transaction') {
      this.serial += 1;
      const reference = `MP${String(this.serial).padStart(8, '0')}`;
      this.references.set(request.clientCorrelator, reference);
      aligned.transaction = { ...aligned.transaction, ecocashReference: reference };
    }
    return aligned;
  }

  async lookup(request: { clientCorrelator: string; endUserId: string }): Promise<EcocashProviderResult> {
    this.lookups += 1;
    const next = this.blockLookups
      ? await new Promise<EcocashProviderResult>((resolveLookup) => {
        this.blocks.push(resolveLookup);
      })
      : await (this.lookupQueue.shift() ?? this.chargeResult);
    if (next.kind === 'transaction') {
      const stored = this.references.get(request.clientCorrelator);
      return {
        ...next,
        transaction: {
          ...next.transaction,
          clientCorrelator: request.clientCorrelator,
          ecocashReference: next.transaction.ecocashReference === 'MP-ADMIN'
            ? 'MP-ADMIN'
            : stored ?? next.transaction.ecocashReference,
        },
      };
    }
    return next;
  }
}

function charged(
  clientCorrelator = '1234567890123456',
  referenceCode = 'RDR1234567890123456',
  ecocashReference = 'MP-LOOKUP',
  amountCents: number | null = null,
  currency: string | null = null,
): EcocashProviderResult {
  const transaction: EcocashTransaction = {
    clientCorrelator,
    referenceCode,
    endUserId: '771234567',
    ecocashReference,
    transactionOperationStatus: 'Charged',
    responseCode: '00',
    amountCents,
    currency,
  };
  return { kind: 'transaction', httpStatus: 200, transaction };
}

function align(result: EcocashProviderResult, request: EcocashChargeRequest): EcocashProviderResult {
  if (result.kind !== 'transaction') {
    return result;
  }
  return {
    ...result,
    transaction: {
      ...result.transaction,
      clientCorrelator: request.clientCorrelator,
      referenceCode: request.referenceCode,
      endUserId: request.endUserId,
    },
  };
}

async function applyMigrations(connected: pg.Client): Promise<void> {
  const names = readdirSync(resolve(BACKEND, 'prisma/migrations'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const server = await connected.query('SHOW server_version');
  if (!String(server.rows[0]?.server_version).startsWith('17.')) {
    throw new Error('Refusing a database that is not PostgreSQL 17');
  }
  for (const name of names) {
    assertDisposable(DISPOSABLE_URL);
    const sql = readFileSync(resolve(BACKEND, 'prisma/migrations', name, 'migration.sql'), 'utf8');
    const client = new pg.Client({ connectionString: DISPOSABLE_URL });
    await client.connect();
    try {
      const current = await client.query('SELECT current_database() AS database');
      if (current.rows[0]?.database !== DATABASE) {
        throw new Error('Refusing to migrate a database that is not the disposable EcoCash database');
      }
      await client.query('BEGIN');
      for (const statement of sqlStatements(sql)) {
        await client.query(statement);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      const caught = error as { code?: string; message?: string };
      throw new Error(`${name} failed (${caught.code ?? 'unknown'}): ${caught.message ?? ''}`);
    } finally {
      await client.end();
    }
  }
}

function sqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let dollar = '';
  for (let index = 0; index < sql.length; index += 1) {
    if (!dollar && sql.startsWith('--', index)) {
      const newline = sql.indexOf('\n', index);
      index = newline === -1 ? sql.length : newline;
      continue;
    }
    const tag = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(index));
    if (tag) {
      if (!dollar) dollar = tag[0];
      else if (dollar === tag[0]) dollar = '';
      current += tag[0];
      index += tag[0].length - 1;
      continue;
    }
    if (!dollar && sql[index] === ';') {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = '';
      continue;
    }
    current += sql[index];
  }
  const statement = current.trim();
  if (statement) statements.push(statement);
  return statements;
}

async function seed(): Promise<void> {
  const now = new Date();
  const later = new Date(now.getTime() + 60 * 60 * 1000);
  await prisma.user.create({
    data: {
      id: ADMIN,
      fullName: 'Admin',
      phone: '+263770000001',
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
      passwordHash: 'not-a-real-password',
    },
  });
  for (const rider of [
    { userId: USER_A, profileId: PROFILE_A, phone: '+263771110001', sessionId: SESSION_A, familyId: FAMILY_A },
    { userId: USER_B, profileId: PROFILE_B, phone: '+263771110002', sessionId: SESSION_B, familyId: FAMILY_B },
  ]) {
    await prisma.user.create({
      data: {
        id: rider.userId,
        fullName: 'Rider',
        phone: rider.phone,
        role: 'RIDER',
        accountStatus: 'ACTIVE',
        phoneVerifiedAt: now,
        whatsappConsentAt: now,
        riderProfile: { create: { id: rider.profileId } },
        refreshSessions: {
          create: {
            id: rider.sessionId,
            familyId: rider.familyId,
            tokenHash: rider.sessionId.replaceAll('-', '').padEnd(64, 'a'),
            expiresAt: later,
            familyExpiresAt: later,
          },
        },
      },
    });
  }
  await prisma.user.create({
    data: {
      id: USER_C,
      fullName: 'Customer',
      phone: '+263771110003',
      role: 'CUSTOMER',
      accountStatus: 'ACTIVE',
      phoneVerifiedAt: now,
      whatsappConsentAt: now,
      refreshSessions: {
        create: {
          id: SESSION_C,
          familyId: FAMILY_C,
          tokenHash: SESSION_C.replaceAll('-', '').padEnd(64, 'c'),
          expiresAt: later,
          familyExpiresAt: later,
        },
      },
    },
  });
  const wallet = await prisma.riderWallet.create({
    data: {
      riderProfileId: PROFILE_A,
      currency: 'USD',
      balance: '2.00',
      promotionalBalance: '1.00',
      borrowingLimitOverride: '5.00',
    },
  });
  const payment = await prisma.walletPayment.create({
    data: {
      riderWalletId: wallet.id,
      method: 'CASH',
      status: 'VERIFIED',
      amount: '2.00',
      currency: 'USD',
      internalReceiptId: 'CRTESTRECEIPT0001',
      idempotencyKey: 'admin-cash-1',
      payloadHash: 'd'.repeat(64),
      confirmedById: ADMIN,
      verifiedAt: now,
    },
  });
  await prisma.walletPayment.create({
    data: {
      riderWalletId: wallet.id,
      method: 'ECOCASH',
      status: 'VERIFIED',
      amount: '1.00',
      currency: 'USD',
      ecocashReference: 'MP-ADMIN',
      idempotencyKey: 'admin-eco-1',
      payloadHash: 'e'.repeat(64),
      confirmedById: ADMIN,
      verifiedAt: now,
    },
  });
  await prisma.riderWalletEntry.create({
    data: {
      riderWalletId: wallet.id,
      entryType: 'TOP_UP',
      amount: '2.00',
      balanceAfter: '2.00',
      currency: 'USD',
      configVersion: 1,
      idempotencyKey: 'admin-cash-entry',
      payloadHash: 'f'.repeat(64),
      walletPaymentId: payment.id,
      actorType: 'ADMIN',
      actorId: ADMIN,
    },
  });
  await prisma.walletFeeReservation.create({
    data: {
      riderWalletId: wallet.id,
      amount: '0.30',
      promotionalAmount: '0.10',
      walletAmount: '0.20',
      currency: 'USD',
      configVersion: 1,
      status: 'OPEN',
    },
  });
  await prisma.riderWallet.create({
    data: {
      riderProfileId: PROFILE_B,
      currency: 'USD',
      balance: '0.00',
      promotionalBalance: '0.00',
    },
  });
}

function configuredDatabaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  const text = readFileSync(resolve(BACKEND, '.env'), 'utf8');
  const line = text.split(/\r?\n/).find((entry) => entry.startsWith('DATABASE_URL='));
  if (!line) {
    throw new Error('DATABASE_URL missing');
  }
  return line.slice('DATABASE_URL='.length).trim().replace(/^"|"$/g, '');
}

function assertDevelopmentDatabase(databaseUrl: string): void {
  const parsed = new URL(databaseUrl);
  const port = parsed.port || '5432';
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname) || port !== '5432' || database !== 'delivery_db') {
    throw new Error('Refusing to run while the configured database is not local delivery_db');
  }
  if (/supabase|railway|rlwy|neon/i.test(parsed.hostname)) {
    throw new Error('Refusing a hosted database');
  }
}

function assertDisposable(databaseUrl: string): void {
  const parsed = new URL(databaseUrl);
  if (parsed.hostname !== HOST || parsed.port !== String(PORT) || parsed.pathname !== `/${DATABASE}`) {
    throw new Error('Refusing a database that is not the disposable EcoCash test database');
  }
  if (parsed.pathname.includes('delivery_db') || /supabase|railway|rlwy|neon/i.test(databaseUrl)) {
    throw new Error('Refusing a hosted or development database');
  }
}

async function checksum(databaseUrl: string): Promise<string> {
  assertDevelopmentDatabase(databaseUrl);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const result = await client.query(`
    SELECT md5(CONCAT(
      (SELECT COUNT(*) FROM rider_wallets),
      (SELECT md5(COALESCE(string_agg(balance::text, ',' ORDER BY id), '')) FROM rider_wallets),
      (SELECT md5(COALESCE(string_agg(promotional_balance::text, ',' ORDER BY id), '')) FROM rider_wallets),
      (SELECT COUNT(*) FROM rider_wallet_entries),
      (SELECT COUNT(*) FROM wallet_payments),
      (SELECT COUNT(*) FROM wallet_fee_reservations),
      (SELECT COUNT(*) FROM wallet_borrowing_limit_audits)
    )) AS checksum
  `);
  await client.end();
  return String(result.rows[0]?.checksum);
}

function rememberEnv(): void {
  for (const key of ['DATABASE_URL', 'DATABASE_SSL_CA', 'NODE_ENV', 'JWT_ACCESS_SECRET', 'ECOCASH_ENABLED', 'ECOCASH_ENVIRONMENT', 'ECOCASH_SANDBOX_BASE_URL', 'ECOCASH_USERNAME', 'ECOCASH_PASSWORD', 'ECOCASH_MERCHANT_CODE', 'ECOCASH_MERCHANT_NUMBER', 'ECOCASH_MERCHANT_PIN', 'ECOCASH_TERMINAL_ID', 'ECOCASH_LOCATION', 'ECOCASH_SUPER_MERCHANT_NAME', 'ECOCASH_MERCHANT_NAME', 'ECOCASH_PURCHASE_CATEGORY', 'ECOCASH_CHARGE_DESCRIPTION', 'TRUST_RAILWAY_EDGE_CLIENT_IP']) {
    if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
  }
}

async function waitForPostgres(): Promise<pg.Client> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < 90_000) {
    const client = new pg.Client({ connectionString: DISPOSABLE_URL, connectionTimeoutMillis: 1000 });
    try {
      await client.connect();
      await client.query('SELECT 1');
      return client;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('PostgreSQL did not start');
}
