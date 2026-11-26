import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { UserRole, WalletEntryType } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BidAcceptanceService } from '../delivery/bid-acceptance.service.js';
import { BidService } from '../delivery/bid.service.js';
import { centsFromDecimal } from '../delivery/money.js';
import { issuePromotionalCredit } from './promotional-credit.js';
import {
  captureV2CommissionReservation,
  refundAcceptanceCommission,
  releasePlatformFeeReservation,
  postLedgerEntry,
} from './wallet-ledger.js';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const PRISMA_CLI = require.resolve('prisma/build/index.js');
const HOST = '127.0.0.1';
const PORT = 54480;
const DATABASE = 'wallet_phase2';
const CONTAINER = 'riders-wallet-phase2-pg';
const DISPOSABLE_URL = `postgresql://postgres:postgres@${HOST}:${PORT}/${DATABASE}`;
const NOW = new Date('2026-11-16T08:00:00.000Z');
const DEADLINE = new Date('2026-11-16T18:00:00.000Z');

let prisma: PrismaService;
let bids: BidService;
let acceptance: BidAcceptanceService;
let customer: { userId: string; role: typeof UserRole.CUSTOMER; customerAccountId: string };
let adminId = '';
let phone = 771200000;
let registration = 4000;
const previousDatabaseUrl = process.env.DATABASE_URL;
const previousFlag = process.env.V2_MARKETPLACE_ENABLED;
const previousSsl = process.env.DATABASE_SSL_CA;

beforeAll(async () => {
  process.env.RIDER_ZWG_OFFERS_ENABLED = 'true';
  const parsed = new URL(DISPOSABLE_URL);
  if (parsed.hostname !== HOST || parsed.port !== String(PORT) || parsed.pathname !== `/${DATABASE}`) {
    throw new Error('Refusing to use a database that is not the disposable wallet phase 2 database');
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
  const observer = await waitForPostgres();
  const hosted = await observer.query("SELECT nspname FROM pg_namespace WHERE nspname IN ('auth', 'storage', 'supabase_migrations')");
  if (hosted.rows.length > 0) {
    await observer.end();
    throw new Error('Refusing a database that already contains hosted Supabase schemas');
  }
  process.env.DATABASE_URL = DISPOSABLE_URL;
  delete process.env.DATABASE_SSL_CA;
  process.env.V2_MARKETPLACE_ENABLED = 'true';
  try {
    await exec(process.execPath, [PRISMA_CLI, 'db', 'push', '--accept-data-loss'], {
      cwd: process.cwd(),
      env: process.env,
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    });
  } finally {
    await observer.end().catch(() => undefined);
  }
  prisma = new PrismaService();
  await prisma.$connect();
  bids = new BidService(prisma);
  acceptance = new BidAcceptanceService(prisma);
  const admin = await prisma.user.create({
    data: { fullName: 'Admin', phone: nextPhone(), role: UserRole.ADMIN, accountStatus: 'ACTIVE', phoneVerifiedAt: NOW },
  });
  adminId = admin.id;
  const customerUser = await prisma.user.create({
    data: { fullName: 'Customer', phone: nextPhone(), role: UserRole.CUSTOMER, accountStatus: 'ACTIVE', phoneVerifiedAt: NOW },
  });
  const account = await prisma.customerAccount.create({
    data: { userId: customerUser.id, kind: 'INDIVIDUAL', name: 'Customer', address: 'Harare' },
  });
  customer = { userId: customerUser.id, role: UserRole.CUSTOMER, customerAccountId: account.id };
  await prisma.walletConfig.create({
    data: {
      configVersion: 1,
      currency: 'USD',
      welcomeBonus: '0.00',
      defaultBorrowingLimit: '50.00',
      platformFee: '1.50',
      isActive: true,
      createdById: adminId,
    },
  });
  await prisma.v2CommissionRate.create({
    data: { rateVersion: 1, basisPoints: 1_000, isActive: true, createdById: adminId },
  });
  await prisma.exchangeRate.create({
    data: { rateVersion: 1, zigPerUsd: '33.0000', isActive: true, createdById: adminId },
  });
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect().catch(() => undefined);
  await exec('docker', ['rm', '-f', CONTAINER], { windowsHide: true }).catch(() => undefined);
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  if (previousFlag === undefined) delete process.env.V2_MARKETPLACE_ENABLED;
  else process.env.V2_MARKETPLACE_ENABLED = previousFlag;
  if (previousSsl === undefined) delete process.env.DATABASE_SSL_CA;
  else process.env.DATABASE_SSL_CA = previousSsl;
  delete process.env.RIDER_ZWG_OFFERS_ENABLED;
}, 60_000);

it('reserves and captures a USD commission on the USD wallet', async () => {
  const riderId = await createRider({ usd: '10.00', zig: '10.00', limit: '0.00' });
  const opened = await openBid(riderId, 'USD', '10.00');
  const accepted = await acceptance.accept(customer, opened.deliveryId, opened.bidId, `usd-accept-${opened.deliveryId}`, NOW);
  const captured = await prisma.$transaction((tx) => captureV2CommissionReservation(
    tx,
    opened.deliveryId,
    riderId,
    accepted.assignmentId,
    NOW,
  ));
  const replayed = await prisma.$transaction((tx) => captureV2CommissionReservation(
    tx,
    opened.deliveryId,
    riderId,
    accepted.assignmentId,
    NOW,
  ));
  const usd = await wallet(riderId, 'USD');
  const zig = await wallet(riderId, 'ZWG');
  expect(captured).toMatchObject({ captured: true, replayed: false, currency: 'USD', amount: '-1.00' });
  expect(replayed).toMatchObject({ captured: true, replayed: true, currency: 'USD' });
  expect(usd.balance.toFixed(2)).toBe('9.00');
  expect(zig.balance.toFixed(2)).toBe('10.00');
  expect(await prisma.riderWalletEntry.count({ where: { riderWalletId: usd.id, entryType: WalletEntryType.PLATFORM_FEE } })).toBe(1);
  expect(await prisma.riderWalletEntry.count({ where: { riderWalletId: zig.id, entryType: WalletEntryType.PLATFORM_FEE } })).toBe(0);
});

it('reserves and captures a ZiG commission on the ZiG wallet', async () => {
  const riderId = await createRider({ usd: '0.00', zig: '10.00', limit: '0.00' });
  const opened = await openBid(riderId, 'ZWG', '10.00');
  const accepted = await acceptance.accept(customer, opened.deliveryId, opened.bidId, `zig-accept-${opened.deliveryId}`, NOW);
  const reservation = await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: accepted.assignmentId } });
  expect(reservation).toMatchObject({ currency: 'ZWG', status: 'OPEN' });
  expect(reservation.riderWalletId).toBe((await wallet(riderId, 'ZWG')).id);
  const captured = await prisma.$transaction((tx) => captureV2CommissionReservation(
    tx,
    opened.deliveryId,
    riderId,
    accepted.assignmentId,
    NOW,
  ));
  expect(captured).toMatchObject({ captured: true, currency: 'ZWG', amount: '-1.00', balance: '9.00' });
  expect((await wallet(riderId, 'USD')).balance.toFixed(2)).toBe('0.00');
});

it('rejects a new paid ZiG reservation when both wallets have no capacity', async () => {
  const riderId = await createRider({ usd: '0.00', zig: '0.00', limit: '0.00' });
  const opened = await openBid(riderId, 'ZWG', '10.00');
  await expect(acceptance.accept(customer, opened.deliveryId, opened.bidId, `zig-empty-${opened.deliveryId}`, NOW))
    .rejects.toThrow('Wallet capacity is not enough for this bid');
  expect((await wallet(riderId, 'ZWG')).balance.toFixed(2)).toBe('0.00');
  expect(await prisma.walletFeeReservation.count({ where: { deliveryId: opened.deliveryId } })).toBe(0);
});

it('uses USD promotional credit for a ZiG commission before touching ZiG', async () => {
  const riderId = await createRider({ usd: '0.00', zig: '10.00', limit: '0.00' });
  const usd = await wallet(riderId, 'USD');
  await prisma.$transaction((tx) => issuePromotionalCredit(tx, usd, {
    riderProfileId: riderId,
    entryType: WalletEntryType.PROMOTIONAL_CREDIT,
    amountCents: 500,
    idempotencyKey: `promo-usd-${riderId}`,
    reason: 'Phase 2 isolation',
    actorType: 'ADMIN',
    actorId: adminId,
    now: NOW,
    configVersion: 1,
  }));
  const zigBid = await openBid(riderId, 'ZWG', '10.00');
  const accepted = await acceptance.accept(customer, zigBid.deliveryId, zigBid.bidId, `promo-zig-${zigBid.deliveryId}`, NOW);
  const reservation = await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: accepted.assignmentId } });
  expect(reservation).toMatchObject({ currency: 'USD', sourceCurrency: 'ZWG' });
  expect(centsFromDecimal(reservation.amount)).toBe(3);
  expect(centsFromDecimal(reservation.promotionalAmount!)).toBe(3);
  expect(centsFromDecimal(reservation.walletAmount!)).toBe(0);
  expect(reservation.riderWalletId).toBe(usd.id);
  expect((await wallet(riderId, 'ZWG')).balance.toFixed(2)).toBe('10.00');
  expect((await wallet(riderId, 'USD')).promotionalBalance.toFixed(2)).toBe('5.00');
});

it('releases only the reservation for the cancelled delivery currency', async () => {
  const riderId = await createRider({ usd: '10.00', zig: '10.00', limit: '0.00' });
  const usdBid = await openBid(riderId, 'USD', '10.00');
  const zigBid = await openBid(riderId, 'ZWG', '10.00');
  const usdAccepted = await acceptance.accept(customer, usdBid.deliveryId, usdBid.bidId, `rel-usd-${usdBid.deliveryId}`, NOW);
  const zigAccepted = await acceptance.accept(customer, zigBid.deliveryId, zigBid.bidId, `rel-zig-${zigBid.deliveryId}`, NOW);
  await prisma.$transaction((tx) => releasePlatformFeeReservation(tx, zigBid.deliveryId, NOW));
  const usdReservation = await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: usdAccepted.assignmentId } });
  const zigReservation = await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: zigAccepted.assignmentId } });
  expect(usdReservation).toMatchObject({ currency: 'USD', status: 'OPEN', sourceCurrency: 'USD' });
  expect(zigReservation).toMatchObject({ currency: 'USD', status: 'RELEASED', sourceCurrency: 'ZWG' });
  expect(centsFromDecimal(zigReservation.amount)).toBe(3);
  expect((await wallet(riderId, 'USD')).balance.toFixed(2)).toBe('10.00');
  expect((await wallet(riderId, 'ZWG')).balance.toFixed(2)).toBe('10.00');
});

it('refunds a captured fee to the wallet that was charged', async () => {
  const riderId = await createRider({ usd: '10.00', zig: '10.00', limit: '0.00' });
  const opened = await openBid(riderId, 'ZWG', '10.00');
  const accepted = await acceptance.accept(customer, opened.deliveryId, opened.bidId, `refund-${opened.deliveryId}`, NOW);
  await prisma.$transaction((tx) => captureV2CommissionReservation(tx, opened.deliveryId, riderId, accepted.assignmentId, NOW));
  const assignment = await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: accepted.assignmentId } });
  const reservation = await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: assignment.id } });
  expect(reservation).toMatchObject({ currency: 'USD', sourceCurrency: 'ZWG', exchangeRateVersion: 1 });
  await prisma.deliveryAssignment.update({
    where: { id: assignment.id },
    data: {
      acceptedCommissionModel: 'ON_ACCEPTANCE',
      acceptedPlatformFee: reservation.amount,
      acceptedFeeConfigVersion: assignment.acceptedV2CommissionRateVersion,
    },
  });
  await prisma.$transaction((tx) => refundAcceptanceCommission(tx, assignment.id, NOW));
  await prisma.$transaction((tx) => refundAcceptanceCommission(tx, assignment.id, NOW));
  const usd = await wallet(riderId, 'USD');
  expect(usd.balance.toFixed(2)).toBe('10.00');
  expect((await wallet(riderId, 'ZWG')).balance.toFixed(2)).toBe('10.00');
  expect(await prisma.riderWalletEntry.count({
    where: { riderWalletId: usd.id, entryType: WalletEntryType.PLATFORM_FEE_REFUND },
  })).toBe(1);
});

it('allows bidding on the final USD trip while cash capacity is positive', async () => {
  const riderId = await createRider({ usd: '-4.90', zig: '0.00', limit: '5.00' });
  const rider = { userId: 'unused', riderProfileId: riderId };
  const deliveryId = await createDelivery('USD');
  const submitted = await bids.submit(rider, { deliveryId, amountCents: 2_000, currency: 'USD' }, `last-usd-bid-${deliveryId}`, NOW);
  expect(submitted.currency).toBe('USD');
  expect(await prisma.walletFeeReservation.count({ where: { deliveryId } })).toBe(0);
});

it('reserves the entire last USD commission past the limit and blocks further paid trips', async () => {
  const riderId = await createRider({ usd: '-4.90', zig: '0.00', limit: '5.00' });
  const first = await openBid(riderId, 'USD', '20.00');
  const second = await openBid(riderId, 'USD', '20.00');
  const accepted = await acceptance.accept(customer, first.deliveryId, first.bidId, `last-usd-${first.deliveryId}`, NOW);
  const hold = await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: accepted.assignmentId } });
  expect(hold.status).toBe('OPEN');
  expect(centsFromDecimal(hold.amount)).toBe(200);
  expect(centsFromDecimal(hold.walletAmount!)).toBe(200);
  expect((await wallet(riderId, 'USD')).balance.toFixed(2)).toBe('-4.90');
  await expect(acceptance.accept(customer, second.deliveryId, second.bidId, `last-usd-block-${second.deliveryId}`, NOW))
    .rejects.toThrow('Wallet capacity is not enough for this bid');
  const captured = await prisma.$transaction((tx) => captureV2CommissionReservation(tx, first.deliveryId, riderId, accepted.assignmentId, NOW));
  expect(captured).toMatchObject({ captured: true, currency: 'USD', amount: '-2.00', balance: '-6.90' });
  await expect(acceptance.accept(customer, second.deliveryId, second.bidId, `last-usd-block-after-${second.deliveryId}`, NOW))
    .rejects.toThrow('Wallet capacity is not enough for this bid');
  // An ordinary credit reduces the debt and reopens capacity.
  await prisma.$transaction((tx) => postLedgerEntry(tx, {
    riderProfileId: riderId, currency: 'USD', entryType: WalletEntryType.ADJUSTMENT,
    amountCents: 200, idempotencyKey: `last-usd-credit-${riderId}`,
    reason: 'Restore capacity in test', walletPaymentId: null, actorType: 'ADMIN', actorId: adminId, now: NOW,
  }));
  expect((await wallet(riderId, 'USD')).balance.toFixed(2)).toBe('-4.90');
  const next = await acceptance.accept(customer, second.deliveryId, second.bidId, `last-usd-restored-${second.deliveryId}`, NOW);
  expect(next.assignmentId).toBeTruthy();
});

it('serializes competing acceptances for the final USD trip', async () => {
  const riderId = await createRider({ usd: '-4.90', zig: '0.00', limit: '5.00' });
  const first = await openBid(riderId, 'USD', '20.00');
  const second = await openBid(riderId, 'USD', '20.00');
  const results = await Promise.allSettled([
    acceptance.accept(customer, first.deliveryId, first.bidId, `last-usd-race-a-${first.deliveryId}`, NOW),
    acceptance.accept(customer, second.deliveryId, second.bidId, `last-usd-race-b-${second.deliveryId}`, NOW),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((result) => result.status === 'rejected');
  expect(rejected).toMatchObject({ status: 'rejected', reason: { message: 'Wallet capacity is not enough for this bid' } });
  const holds = await prisma.walletFeeReservation.findMany({ where: { riderWalletId: (await wallet(riderId, 'USD')).id, status: 'OPEN' } });
  expect(holds).toHaveLength(1);
  expect(centsFromDecimal(holds[0]!.amount)).toBe(200);
});

it('allows an unrestricted ZiG final trip, captures it, and restores capacity after credit', async () => {
  const riderId = await createRider({ usd: '0.00', zig: '0.10', limit: '0.00' });
  const first = await openBid(riderId, 'ZWG', '200.00');
  const second = await openBid(riderId, 'ZWG', '200.00');
  const rider = { userId: 'unused', riderProfileId: riderId };
  const listed = await createDelivery('ZWG');
  const submitted = await bids.submit(rider, { deliveryId: listed, amountCents: 20_000, currency: 'ZWG' }, `last-zig-bid-${listed}`, NOW);
  expect(submitted.currency).toBe('ZWG');
  const accepted = await acceptance.accept(customer, first.deliveryId, first.bidId, `last-zig-${first.deliveryId}`, NOW);
  const hold = await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: accepted.assignmentId } });
  expect(hold.currency).toBe('ZWG');
  expect(centsFromDecimal(hold.walletAmount!)).toBe(2000);
  await expect(acceptance.accept(customer, second.deliveryId, second.bidId, `last-zig-block-${second.deliveryId}`, NOW))
    .rejects.toThrow('Wallet capacity is not enough for this bid');
  const captured = await prisma.$transaction((tx) => captureV2CommissionReservation(tx, first.deliveryId, riderId, accepted.assignmentId, NOW));
  expect(captured).toMatchObject({ captured: true, currency: 'ZWG', amount: '-20.00', balance: '-19.90' });
  await expect(acceptance.accept(customer, second.deliveryId, second.bidId, `last-zig-block-after-${second.deliveryId}`, NOW))
    .rejects.toThrow('Wallet capacity is not enough for this bid');
  await prisma.$transaction((tx) => postLedgerEntry(tx, {
    riderProfileId: riderId, currency: 'ZWG', entryType: WalletEntryType.ADJUSTMENT,
    amountCents: 1_000, idempotencyKey: `last-zig-partial-credit-${riderId}`,
    reason: 'Reduce debt in test', walletPaymentId: null, actorType: 'ADMIN', actorId: adminId, now: NOW,
  }));
  expect((await wallet(riderId, 'ZWG')).balance.toFixed(2)).toBe('-9.90');
  await expect(acceptance.accept(customer, second.deliveryId, second.bidId, `last-zig-still-blocked-${second.deliveryId}`, NOW))
    .rejects.toThrow('Wallet capacity is not enough for this bid');
  await prisma.$transaction((tx) => postLedgerEntry(tx, {
    riderProfileId: riderId, currency: 'ZWG', entryType: WalletEntryType.ADJUSTMENT,
    amountCents: 1_000, idempotencyKey: `last-zig-restore-credit-${riderId}`,
    reason: 'Restore capacity in test', walletPaymentId: null, actorType: 'ADMIN', actorId: adminId, now: NOW,
  }));
  expect((await wallet(riderId, 'ZWG')).balance.toFixed(2)).toBe('0.10');
  const next = await acceptance.accept(customer, second.deliveryId, second.bidId, `last-zig-restored-${second.deliveryId}`, NOW);
  expect(next.assignmentId).toBeTruthy();
});

it('stops a second concurrent acceptance when the sole USD wallet capacity is exhausted', async () => {
  const riderId = await createRider({ usd: '0.00', zig: '0.00', limit: '1.00' });
  const first = await openBid(riderId, 'USD', '10.00');
  const second = await openBid(riderId, 'USD', '10.00');
  const results = await Promise.allSettled([
    acceptance.accept(customer, first.deliveryId, first.bidId, `cap-a-${first.deliveryId}`, NOW),
    acceptance.accept(customer, second.deliveryId, second.bidId, `cap-b-${second.deliveryId}`, NOW),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  const open = await prisma.walletFeeReservation.findMany({ where: { riderWalletId: (await wallet(riderId, 'USD')).id, status: 'OPEN' } });
  expect(open).toHaveLength(1);
  expect(centsFromDecimal(open[0]!.amount)).toBe(100);
});

it('uses ZiG when USD borrowing is exhausted and keeps the USD wallet uncharged', async () => {
  const riderId = await createRider({ usd: '-5.00', zig: '20.00', limit: '5.00' });
  const rider = { userId: 'unused', riderProfileId: riderId };
  const usdDelivery = await createDelivery('USD');
  const zigDelivery = await createDelivery('ZWG');
  const usdSaved = await bids.submit(rider, { deliveryId: usdDelivery, amountCents: 1_000, currency: 'USD' }, `fallback-usd-${usdDelivery}`, NOW);
  expect(usdSaved.currency).toBe('USD');
  const saved = await bids.submit(rider, { deliveryId: zigDelivery, amountCents: 1_000, currency: 'ZWG' }, `fallback-zig-${zigDelivery}`, NOW);
  expect(saved.currency).toBe('ZWG');
  const listed = (await bids.listOpenRequests(rider, NOW)).map((row) => row.id);
  expect(listed).toContain(zigDelivery);
  expect(listed).toContain(usdDelivery);
  expect((await wallet(riderId, 'USD')).balance.toFixed(2)).toBe('-5.00');
});

it('stops a second concurrent ZiG acceptance from reusing the last ZiG cash capacity', async () => {
  const riderId = await createRider({ usd: '-5.00', zig: '0.10', limit: '0.00' });
  const first = await openBid(riderId, 'ZWG', '200.00');
  const second = await openBid(riderId, 'ZWG', '200.00');
  const results = await Promise.allSettled([
    acceptance.accept(customer, first.deliveryId, first.bidId, `zig-cap-a-${first.deliveryId}`, NOW),
    acceptance.accept(customer, second.deliveryId, second.bidId, `zig-cap-b-${second.deliveryId}`, NOW),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  const open = await prisma.walletFeeReservation.findMany({ where: { riderWalletId: (await wallet(riderId, 'ZWG')).id, status: 'OPEN' } });
  expect(open).toHaveLength(1);
  expect(centsFromDecimal(open[0]!.amount)).toBe(2000);
  expect((await wallet(riderId, 'USD')).balance.toFixed(2)).toBe('-5.00');
});

it('allows a ZiG bid while USD is negative and borrowing capacity remains', async () => {
  const riderId = await createRider({ usd: '-2.00', zig: '20.00', limit: '5.00' });
  const rider = { userId: 'unused', riderProfileId: riderId };
  const zigDelivery = await createDelivery('ZWG');
  const saved = await bids.submit(rider, { deliveryId: zigDelivery, amountCents: 1_000, currency: 'ZWG' }, `room-zig-${zigDelivery}`, NOW);
  expect(saved.currency).toBe('ZWG');
  const listed = await bids.listOpenRequests(rider, NOW);
  expect(listed.map((row) => row.id)).toContain(zigDelivery);
});

it('rejects a bid whose currency does not match the delivery', async () => {
  const riderId = await createRider({ usd: '0.00', zig: '20.00', limit: '50.00' });
  const rider = { userId: 'unused', riderProfileId: riderId };
  const zigDelivery = await createDelivery('ZWG');
  await expect(bids.submit(rider, { deliveryId: zigDelivery, amountCents: 1_000, currency: 'USD' }, `mismatch-${zigDelivery}`, NOW))
    .rejects.toThrow('This bid currency does not match the delivery');
  expect(await prisma.bid.count({ where: { deliveryId: zigDelivery } })).toBe(0);
});

it('charges USD for a ZiG delivery when both wallets are funded', async () => {
  const riderId = await createRider({ usd: '1.00', zig: '10.00', limit: '0.00' });
  const opened = await openBid(riderId, 'ZWG', '10.00');
  const accepted = await acceptance.accept(customer, opened.deliveryId, opened.bidId, `both-zig-${opened.deliveryId}`, NOW);
  const reservation = await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: accepted.assignmentId } });
  expect(reservation).toMatchObject({
    currency: 'USD',
    sourceCurrency: 'ZWG',
    exchangeRateVersion: 1,
    exchangeRateZigPerUsd: expect.anything(),
  });
  expect(centsFromDecimal(reservation.amount)).toBe(3);
  expect(centsFromDecimal(reservation.sourceAmount!)).toBe(100);
  expect(reservation.riderWalletId).toBe((await wallet(riderId, 'USD')).id);
});

it('charges USD borrowing capacity for a ZiG commission when ZiG is empty', async () => {
  const riderId = await createRider({ usd: '0.00', zig: '0.00', limit: '50.00' });
  const opened = await openBid(riderId, 'ZWG', '10.00');
  const accepted = await acceptance.accept(customer, opened.deliveryId, opened.bidId, `borrow-zig-${opened.deliveryId}`, NOW);
  const captured = await prisma.$transaction((tx) => captureV2CommissionReservation(
    tx,
    opened.deliveryId,
    riderId,
    accepted.assignmentId,
    NOW,
  ));
  expect(captured).toMatchObject({ captured: true, currency: 'USD', amount: '-0.03' });
  expect((await wallet(riderId, 'USD')).balance.toFixed(2)).toBe('-0.03');
  expect((await wallet(riderId, 'ZWG')).balance.toFixed(2)).toBe('0.00');
});

it('charges ZiG for a USD delivery when the USD wallet cannot cover it', async () => {
  const riderId = await createRider({ usd: '0.00', zig: '33.00', limit: '0.00' });
  const opened = await openBid(riderId, 'USD', '10.00');
  const accepted = await acceptance.accept(customer, opened.deliveryId, opened.bidId, `zig-pays-usd-${opened.deliveryId}`, NOW);
  const reservation = await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: accepted.assignmentId } });
  expect(reservation).toMatchObject({ currency: 'ZWG', sourceCurrency: 'USD', exchangeRateVersion: 1 });
  expect(centsFromDecimal(reservation.amount)).toBe(3_300);
  expect(centsFromDecimal(reservation.sourceAmount!)).toBe(100);
  expect((await wallet(riderId, 'USD')).balance.toFixed(2)).toBe('0.00');
});

it('uses ZiG after an open USD reservation has used the USD capacity', async () => {
  const riderId = await createRider({ usd: '0.03', zig: '10.00', limit: '0.00' });
  const first = await openBid(riderId, 'ZWG', '10.00');
  const second = await openBid(riderId, 'ZWG', '10.00');
  const firstAccepted = await acceptance.accept(customer, first.deliveryId, first.bidId, `hold-usd-${first.deliveryId}`, NOW);
  const secondAccepted = await acceptance.accept(customer, second.deliveryId, second.bidId, `hold-zig-${second.deliveryId}`, NOW);
  const firstReservation = await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: firstAccepted.assignmentId } });
  const secondReservation = await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: secondAccepted.assignmentId } });
  expect(firstReservation).toMatchObject({ currency: 'USD', status: 'OPEN' });
  expect(secondReservation).toMatchObject({ currency: 'ZWG', status: 'OPEN' });
  expect(centsFromDecimal(secondReservation.amount)).toBe(100);
});

it('keeps a captured converted commission on the rate stored with the reservation', async () => {
  const riderId = await createRider({ usd: '1.00', zig: '0.00', limit: '0.00' });
  const opened = await openBid(riderId, 'ZWG', '10.00');
  const accepted = await acceptance.accept(customer, opened.deliveryId, opened.bidId, `rate-${opened.deliveryId}`, NOW);
  const reserved = await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: accepted.assignmentId } });
  expect(centsFromDecimal(reserved.amount)).toBe(3);
  await prisma.exchangeRate.update({ where: { rateVersion: 1 }, data: { isActive: false } });
  await prisma.exchangeRate.create({
    data: { rateVersion: 2, zigPerUsd: '40.0000', isActive: true, createdById: adminId },
  });
  try {
    const captured = await prisma.$transaction((tx) => captureV2CommissionReservation(
      tx,
      opened.deliveryId,
      riderId,
      accepted.assignmentId,
      NOW,
    ));
    expect(captured).toMatchObject({ captured: true, currency: 'USD', amount: '-0.03' });
    expect((await wallet(riderId, 'USD')).balance.toFixed(2)).toBe('0.97');
    const stored = await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: accepted.assignmentId } });
    expect(stored.exchangeRateVersion).toBe(1);
    expect(centsFromDecimal(stored.amount)).toBe(3);
  } finally {
    await prisma.exchangeRate.update({ where: { rateVersion: 2 }, data: { isActive: false } });
    await prisma.exchangeRate.update({ where: { rateVersion: 1 }, data: { isActive: true } });
  }
});

it('rejects a direct ZiG bid and acceptance while ZiG offers are disabled', async () => {
  delete process.env.RIDER_ZWG_OFFERS_ENABLED;
  try {
    const riderId = await createRider({ usd: '10.00', zig: '20.00', limit: '50.00' });
    const rider = { userId: 'unused', riderProfileId: riderId };
    const zigDelivery = await createDelivery('ZWG');
    await expect(bids.submit(rider, { deliveryId: zigDelivery, amountCents: 1_000, currency: 'ZWG' }, `off-${zigDelivery}`, NOW))
      .rejects.toThrow('ZiG deliveries are not available');
    const opened = await openBid(riderId, 'ZWG', '10.00');
    await expect(acceptance.accept(customer, opened.deliveryId, opened.bidId, `off-accept-${opened.deliveryId}`, NOW))
      .rejects.toThrow('ZiG deliveries are not available');
    expect(await prisma.deliveryAssignment.count({ where: { deliveryId: opened.deliveryId } })).toBe(0);
  } finally {
    process.env.RIDER_ZWG_OFFERS_ENABLED = 'true';
  }
});

async function openBid(riderId: string, currency: 'USD' | 'ZWG', amount: string) {
  const delivery = await createDelivery(currency);
  const bid = await prisma.bid.create({
    data: {
      deliveryId: delivery,
      riderProfileId: riderId,
      amount,
      currency,
      status: 'OPEN',
    },
  });
  return { deliveryId: delivery, bidId: bid.id };
}

async function createDelivery(currency: 'USD' | 'ZWG') {
  const delivery = await prisma.delivery.create({
    data: {
      customerId: customer.customerAccountId,
      pickupAddress: 'Pickup',
      pickupCoordinateSource: 'UNREVIEWED',
      pickupContactName: 'Sender',
      pickupContactPhone: '+263770000001',
      dropoffAddress: 'Dropoff',
      dropoffCoordinateSource: 'UNREVIEWED',
      parcelDescription: 'Parcel',
      parcelSize: 'SMALL',
      recipientName: 'Recipient',
      recipientPhone: '+263770000002',
      suggestedPrice: '9.00',
      distanceMeters: 1_000,
      pricingVersion: 1,
      currency,
      serviceClass: 'FLEXIBLE',
      deliverBy: DEADLINE,
      status: 'CREATED',
      searchGeneration: 0,
    },
  });
  return delivery.id;
}

async function createRider(balances: { usd: string; zig: string; limit: string }) {
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
      licenceNumber: `LIC${nextRegistration()}`,
      licenceClass: '4',
      verifiedAt: NOW,
      reviewerId: adminId,
    },
  });
  await prisma.motorcycle.create({
    data: {
      riderProfileId: profile.id,
      registrationNumber: `R${nextRegistration()}`,
      make: 'Honda',
      model: 'Ace',
      colour: 'Red',
      verificationStatus: 'VERIFIED',
      isActive: true,
      verifiedAt: NOW,
      verifiedById: adminId,
    },
  });
  const usd = await prisma.riderWallet.create({
    data: { riderProfileId: profile.id, currency: 'USD', balance: balances.usd, borrowingLimitOverride: balances.limit },
  });
  const zig = await prisma.riderWallet.create({
    data: { riderProfileId: profile.id, currency: 'ZWG', balance: balances.zig, welcomeBonusAwardedAt: NOW },
  });
  await openingEntry(usd.id, 'USD', balances.usd);
  await openingEntry(zig.id, 'ZWG', balances.zig);
  return profile.id;
}

async function openingEntry(walletId: string, currency: 'USD' | 'ZWG', amount: string) {
  if (amount === '0.00' || amount === '0') {
    return;
  }
  await prisma.riderWalletEntry.create({
    data: {
      riderWalletId: walletId,
      entryType: 'ADJUSTMENT',
      amount,
      balanceAfter: amount,
      currency,
      configVersion: 1,
      idempotencyKey: `opening-${walletId}`,
      payloadHash: 'a'.repeat(64),
      reason: 'Opening test balance',
      actorType: 'ADMIN',
      actorId: adminId,
    },
  });
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

function nextRegistration(): string {
  registration += 1;
  return String(registration);
}

async function waitForPostgres() {
  let lastError: unknown;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const client = new pg.Client({ connectionString: DISPOSABLE_URL, connectionTimeoutMillis: 1000 });
    try {
      await client.connect();
      await client.query('SELECT 1');
      return client;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      await delay(500);
    }
  }
  throw lastError;
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
