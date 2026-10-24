import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { UserRole, WalletEntryType } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BidAcceptanceService } from './bid-acceptance.service.js';
import { BidService } from './bid.service.js';
import { DispatchService } from './dispatch.service.js';
import { signedCentsFromDecimal } from '../rider/wallet-money.js';

const exec = promisify(execFile);
const HOST = '127.0.0.1';
const PORT = 54348;
const DATABASE = 'cancel_m5';
const CONTAINER = 'riders-m5-cancel-pg';
const DISPOSABLE_URL = `postgresql://postgres:postgres@${HOST}:${PORT}/${DATABASE}`;
const NOW = new Date('2026-10-24T08:00:00.000Z');
const DEADLINE = new Date('2026-10-24T18:00:00.000Z');
const PRISMA_CLI = resolve(process.cwd(), 'node_modules/prisma/build/index.js');

let prisma: PrismaService;
let acceptance: BidAcceptanceService;
let bids: BidService;
let dispatch: DispatchService;
let customer: { userId: string; role: typeof UserRole.CUSTOMER; customerAccountId: string };
let adminId = '';
let phone = 770030000;
let registration = 4000;
const previousDatabaseUrl = process.env.DATABASE_URL;
const previousFlag = process.env.V2_MARKETPLACE_ENABLED;
const previousSsl = process.env.DATABASE_SSL_CA;

beforeAll(async () => {
  const parsed = new URL(DISPOSABLE_URL);
  if (parsed.hostname !== HOST || parsed.port !== String(PORT) || parsed.pathname !== `/${DATABASE}`) {
    throw new Error('Refusing to use a database that is not the disposable local cancellation test database');
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
    const constraints = readFileSync(new URL('./commission-capture.postgres.sql', import.meta.url), 'utf8');
    for (const statement of sqlStatements(constraints)) {
      await observer.query(statement);
    }
    await observer.query(`
      CREATE UNIQUE INDEX "bids_one_accepted_per_delivery_idx"
        ON "bids" ("delivery_id")
        WHERE "status" = 'ACCEPTED' AND "closed_at" IS NULL
    `);
  } finally {
    await observer.end().catch(() => undefined);
  }
  prisma = new PrismaService();
  await prisma.$connect();
  acceptance = new BidAcceptanceService(prisma);
  bids = new BidService(prisma);
  dispatch = new DispatchService(prisma);
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
}, 60_000);

it('reopens the original delivery after a pre-pickup cancellation and accepts a new bid', async () => {
  const world = await acceptedJob({ competing: true });
  await dispatch.progress(world.rider, world.deliveryId, { status: 'COLLECTING' }, NOW, `collect-${world.deliveryId}`);
  const before = await prisma.delivery.findUniqueOrThrow({ where: { id: world.deliveryId } });
  const cancelled = await dispatch.cancelBeforePickup(
    world.rider,
    world.assignmentId,
    `cancel-${world.assignmentId}`,
    { reason: 'SENDER_UNAVAILABLE', note: 'Gate was locked' },
    NOW,
  );
  const replay = await dispatch.cancelBeforePickup(
    world.rider,
    world.assignmentId,
    `cancel-${world.assignmentId}`,
    { reason: 'SENDER_UNAVAILABLE', note: 'Gate was locked' },
    NOW,
  );
  expect(cancelled).toMatchObject({ status: 'CREATED', reopened: true, released: true, replayed: false, availability: 'AVAILABLE' });
  expect(replay).toMatchObject({ assignmentId: cancelled.assignmentId, replayed: true, released: true, reopened: true });
  const delivery = await prisma.delivery.findUniqueOrThrow({ where: { id: world.deliveryId } });
  expect(delivery.customerId).toBe(before.customerId);
  expect(delivery.pickupAddress).toBe(before.pickupAddress);
  expect(delivery.dropoffAddress).toBe(before.dropoffAddress);
  expect(delivery.parcelDescription).toBe(before.parcelDescription);
  expect(delivery.serviceClass).toBe(before.serviceClass);
  expect(delivery.deliverBy?.toISOString()).toBe(before.deliverBy?.toISOString());
  expect(delivery.suggestedPrice.toFixed(2)).toBe(before.suggestedPrice.toFixed(2));
  expect(delivery.price).toBeNull();
  expect(delivery.status).toBe('CREATED');
  const oldAssignment = await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: world.assignmentId } });
  expect(oldAssignment).toMatchObject({
    status: 'RELEASED',
    releaseReason: 'SENDER_UNAVAILABLE',
    cancellationStage: 'COLLECTING',
    cancellationNote: 'Gate was locked',
  });
  expect(oldAssignment.acceptedCommissionAmount?.toFixed(2)).toBe('1.00');
  const oldBid = await prisma.bid.findUniqueOrThrow({ where: { id: world.bidId } });
  expect(oldBid.status).toBe('ACCEPTED');
  expect(oldBid.closedAt).not.toBeNull();
  expect((await prisma.bid.findUniqueOrThrow({ where: { id: world.otherBidId! } })).status).toBe('SUPERSEDED');
  const reservation = await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: world.assignmentId } });
  expect(reservation.status).toBe('RELEASED');
  expect(await prisma.riderWalletEntry.count({ where: { entryType: WalletEntryType.PLATFORM_FEE } })).toBe(0);
  expect(await prisma.delivery.count({ where: { customerId: customer.customerAccountId } })).toBe(1);

  const next = await hireRider();
  const submitted = await bids.submit(next.rider, { deliveryId: world.deliveryId, amountCents: 1_200 }, `bid-${next.rider.riderProfileId}`, NOW);
  const second = await acceptance.accept(customer, world.deliveryId, submitted.id, `accept-${submitted.id}`, NOW);
  expect(second.assignmentId).not.toBe(world.assignmentId);
  expect(second).toMatchObject({ acceptedBidAmount: '12.00', commissionAmount: '1.20', reserved: true });
  expect(await prisma.deliveryAssignment.count({ where: { deliveryId: world.deliveryId } })).toBe(2);
  expect(await prisma.deliveryAssignment.count({ where: { deliveryId: world.deliveryId, status: 'ACCEPTED' } })).toBe(1);
  const freshReservation = await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: second.assignmentId } });
  expect(freshReservation.status).toBe('OPEN');
  expect(signedCentsFromDecimal(freshReservation.amount)).toBe(120);
  await expect(prisma.bid.update({ where: { id: world.bidId }, data: { closedAt: null } })).rejects.toMatchObject({ code: 'P2002' });
}, 30_000);

it('rejects cancellation after pickup and keeps the reservation open', async () => {
  const world = await acceptedJob();
  await dispatch.progress(world.rider, world.deliveryId, { status: 'COLLECTING' }, NOW, `collect-${world.deliveryId}`);
  await dispatch.progress(world.rider, world.deliveryId, { status: 'COLLECTED' }, NOW, `collected-${world.deliveryId}`);
  await expect(dispatch.cancelBeforePickup(world.rider, world.assignmentId, `late-${world.assignmentId}`, { reason: 'BREAKDOWN' }, NOW))
    .rejects.toThrow('This delivery cannot be cancelled');
  expect((await prisma.delivery.findUnique({ where: { id: world.deliveryId } }))?.status).toBe('COLLECTED');
  expect((await prisma.deliveryAssignment.findUnique({ where: { id: world.assignmentId } }))?.status).toBe('ACCEPTED');
  expect((await prisma.walletFeeReservation.findFirst({ where: { assignmentId: world.assignmentId } }))?.status).toBe('OPEN');
  expect(await prisma.riderWalletEntry.count({ where: { riderWalletId: world.walletId } })).toBe(0);
}, 30_000);

it('lets one of a cancellation and a pickup win', async () => {
  const world = await acceptedJob();
  await dispatch.progress(world.rider, world.deliveryId, { status: 'COLLECTING' }, NOW, `collect-${world.deliveryId}`);
  const results = await Promise.allSettled([
    dispatch.cancelBeforePickup(world.rider, world.assignmentId, `race-${world.assignmentId}`, { reason: 'WRONG_ADDRESS' }, NOW),
    dispatch.progress(world.rider, world.deliveryId, { status: 'COLLECTED' }, NOW, `collected-${world.deliveryId}`),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const delivery = await prisma.delivery.findUniqueOrThrow({ where: { id: world.deliveryId } });
  const assignment = await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: world.assignmentId } });
  const reservation = await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: world.assignmentId } });
  if (delivery.status === 'CREATED') {
    expect(assignment.status).toBe('RELEASED');
    expect(reservation.status).toBe('RELEASED');
  } else {
    expect(delivery.status).toBe('COLLECTED');
    expect(assignment.status).toBe('ACCEPTED');
    expect(reservation.status).toBe('OPEN');
  }
  expect(await prisma.riderWalletEntry.count({ where: { riderWalletId: world.walletId } })).toBe(0);
  expect(await prisma.deliveryAssignment.count({ where: { deliveryId: world.deliveryId, status: 'ACCEPTED' } })).toBe(delivery.status === 'COLLECTED' ? 1 : 0);
}, 30_000);

it('treats two cancellation requests with one key as a single release', async () => {
  const world = await acceptedJob();
  const results = await Promise.all([
    dispatch.cancelBeforePickup(world.rider, world.assignmentId, `same-${world.assignmentId}`, { reason: 'PAYMENT_NOT_AGREED' }, NOW),
    dispatch.cancelBeforePickup(world.rider, world.assignmentId, `same-${world.assignmentId}`, { reason: 'PAYMENT_NOT_AGREED' }, NOW),
  ]);
  expect(results.filter((result) => result.replayed)).toHaveLength(1);
  expect(await prisma.walletFeeReservation.count({ where: { assignmentId: world.assignmentId, status: 'RELEASED' } })).toBe(1);
  expect(await prisma.deliveryAssignment.count({ where: { id: world.assignmentId, status: 'RELEASED' } })).toBe(1);
  await expect(dispatch.cancelBeforePickup(world.rider, world.assignmentId, `same-${world.assignmentId}`, { reason: 'BREAKDOWN' }, NOW))
    .rejects.toThrow('This idempotency key was already used');
  expect(await prisma.walletFeeReservation.count({ where: { assignmentId: world.assignmentId, status: 'RELEASED' } })).toBe(1);
}, 30_000);

it('refuses the V1 release path for a V2 assignment that has reached pickup', async () => {
  const world = await acceptedJob();
  await dispatch.progress(world.rider, world.deliveryId, { status: 'COLLECTING' }, NOW, `collect-${world.deliveryId}`);
  await expect(dispatch.release(world.rider, world.assignmentId, { reason: 'RIDER_CANCELLED' }, NOW))
    .rejects.toThrow('This delivery cannot be released');
  expect((await prisma.delivery.findUnique({ where: { id: world.deliveryId } }))?.status).toBe('COLLECTING');
  expect((await prisma.walletFeeReservation.findFirst({ where: { assignmentId: world.assignmentId } }))?.status).toBe('OPEN');
}, 30_000);

it('closes the original delivery when the deadline has passed', async () => {
  const world = await acceptedJob();
  const cancelled = await dispatch.cancelBeforePickup(
    world.rider,
    world.assignmentId,
    `expired-${world.assignmentId}`,
    { reason: 'OTHER', note: 'The sender deadline passed' },
    DEADLINE,
  );
  expect(cancelled).toMatchObject({ status: 'CANCELLED', reopened: false, released: true });
  const delivery = await prisma.delivery.findUniqueOrThrow({ where: { id: world.deliveryId } });
  expect(delivery.status).toBe('CANCELLED');
  expect(delivery.deliverBy?.toISOString()).toBe(DEADLINE.toISOString());
  expect(delivery.price).toBeNull();
  const next = await hireRider();
  await expect(bids.submit(next.rider, { deliveryId: world.deliveryId, amountCents: 900 }, `closed-${next.rider.riderProfileId}`, NOW))
    .rejects.toThrow('This delivery is not open for bids');
  expect(await prisma.riderWalletEntry.count({ where: { riderWalletId: world.walletId } })).toBe(0);
}, 30_000);

it('cancels a 0% assignment without a wallet or a ledger entry', async () => {
  const active = await prisma.v2CommissionRate.findFirstOrThrow({ where: { isActive: true } });
  await prisma.v2CommissionRate.update({ where: { id: active.id }, data: { isActive: false } });
  const highest = await prisma.v2CommissionRate.findFirstOrThrow({ orderBy: { rateVersion: 'desc' } });
  await prisma.v2CommissionRate.create({
    data: { rateVersion: highest.rateVersion + 1, basisPoints: 0, isActive: true, createdById: adminId },
  });
  const world = await acceptedJob({ wallet: false });
  const cancelled = await dispatch.cancelBeforePickup(world.rider, world.assignmentId, `zero-${world.assignmentId}`, { reason: 'PARCEL_TOO_LARGE' }, NOW);
  expect(cancelled).toMatchObject({ reopened: true, released: false, status: 'CREATED' });
  expect(await prisma.riderWallet.count({ where: { riderProfileId: world.rider.riderProfileId } })).toBe(0);
  expect(await prisma.walletFeeReservation.count({ where: { assignmentId: world.assignmentId } })).toBe(0);
  expect(await prisma.riderWalletEntry.count({ where: { idempotencyKey: `platform-fee:assignment:${world.assignmentId}` } })).toBe(0);
}, 30_000);

async function acceptedJob(options?: { competing?: boolean; wallet?: boolean }) {
  const hired = await hireRider(options?.wallet !== false);
  const rival = options?.competing ? await hireRider(false) : null;
  const delivery = await prisma.delivery.create({
    data: {
      customerId: customer.customerAccountId,
      pickupAddress: 'Pickup road',
      pickupCoordinateSource: 'UNREVIEWED',
      pickupContactName: 'Sender',
      pickupContactPhone: '+263770000001',
      dropoffAddress: 'Dropoff road',
      dropoffCoordinateSource: 'UNREVIEWED',
      parcelDescription: 'Documents',
      parcelSize: 'SMALL',
      recipientName: 'Recipient',
      recipientPhone: '+263770000002',
      suggestedPrice: '9.00',
      distanceMeters: 1_000,
      pricingVersion: 1,
      pricingModel: 'FIXED',
      pricingBasisPoints: 0,
      currency: 'USD',
      serviceClass: 'EXPRESS',
      deliverBy: DEADLINE,
      status: 'CREATED',
      searchGeneration: 0,
    },
  });
  const bid = await prisma.bid.create({
    data: { deliveryId: delivery.id, riderProfileId: hired.rider.riderProfileId, amount: '10.00', currency: 'USD', status: 'OPEN' },
  });
  let otherBidId: string | undefined;
  if (rival) {
    const other = await prisma.bid.create({
      data: { deliveryId: delivery.id, riderProfileId: rival.rider.riderProfileId, amount: '8.00', currency: 'USD', status: 'OPEN' },
    });
    otherBidId = other.id;
  }
  const accepted = await acceptance.accept(customer, delivery.id, bid.id, `accept-${delivery.id}`, NOW);
  return {
    ...hired,
    deliveryId: delivery.id,
    bidId: bid.id,
    otherBidId,
    assignmentId: accepted.assignmentId,
  };
}

async function hireRider(withWallet = true) {
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
  const wallet = withWallet
    ? await prisma.riderWallet.create({
      data: { riderProfileId: profile.id, currency: 'USD', balance: '0.00', borrowingLimitOverride: '50.00' },
    })
    : null;
  return { rider: { userId: user.id, riderProfileId: profile.id }, walletId: wallet?.id ?? '' };
}

function nextPhone(): string {
  phone += 1;
  return `+263${phone}`;
}

function nextRegistration(): string {
  registration += 1;
  return String(registration);
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
      if (current.trim()) statements.push(current.trim());
      current = '';
      continue;
    }
    current += sql[index];
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
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
