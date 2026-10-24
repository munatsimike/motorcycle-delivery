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

const exec = promisify(execFile);
const HOST = '127.0.0.1';
const PORT = 54349;
const DATABASE = 'stabilize_m3';
const CONTAINER = 'riders-m3-stabilize-pg';
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
let phone = 770040000;
let registration = 5000;
const previousDatabaseUrl = process.env.DATABASE_URL;
const previousFlag = process.env.V2_MARKETPLACE_ENABLED;
const previousSsl = process.env.DATABASE_SSL_CA;

beforeAll(async () => {
  const parsed = new URL(DISPOSABLE_URL);
  if (parsed.hostname !== HOST || parsed.port !== String(PORT) || parsed.pathname !== `/${DATABASE}`) {
    throw new Error('Refusing to use a database that is not the disposable local stabilization test database');
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
      CREATE UNIQUE INDEX IF NOT EXISTS "bids_one_accepted_per_delivery_idx"
        ON "bids" ("delivery_id")
        WHERE "status" = 'ACCEPTED' AND "closed_at" IS NULL
    `);
    await observer.query(`
      ALTER TABLE "v2_outbox_events"
        ADD CONSTRAINT "v2_outbox_events_recipient_chk"
        CHECK (
          "attempt_count" >= 0
          AND (
            ("event_type" = 'BID_ACCEPTED' AND "rider_profile_id" IS NOT NULL AND "customer_account_id" IS NULL)
            OR ("event_type" <> 'BID_ACCEPTED' AND "customer_account_id" IS NOT NULL AND "rider_profile_id" IS NULL)
          )
        )
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
      configVersion: 1, currency: 'USD', welcomeBonus: '0.00', defaultBorrowingLimit: '50.00',
      platformFee: '1.50', isActive: true, createdById: adminId,
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

it('cancels a V2 delivery for the customer immediately after acceptance', async () => {
  const world = await acceptedJob();
  const cancelled = await dispatch.cancel(customer, world.deliveryId, NOW);
  expect(cancelled).toEqual({ deliveryId: world.deliveryId, status: 'CANCELLED' });
  const delivery = await prisma.delivery.findUniqueOrThrow({ where: { id: world.deliveryId } });
  expect(delivery.status).toBe('CANCELLED');
  expect(delivery.price?.toFixed(2)).toBe('10.00');
  const assignment = await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: world.assignmentId } });
  expect(assignment).toMatchObject({
    status: 'RELEASED',
    releaseReason: 'CUSTOMER_CANCELLED',
    cancellationStage: 'RIDER_ASSIGNED',
  });
  expect((await prisma.bid.findUniqueOrThrow({ where: { id: world.bidId } })).closedAt).not.toBeNull();
  expect((await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: world.assignmentId } })).status).toBe('RELEASED');
  expect(await prisma.riderWalletEntry.count({ where: { entryType: WalletEntryType.PLATFORM_FEE } })).toBe(0);
  expect((await prisma.riderProfile.findUniqueOrThrow({ where: { id: world.rider.riderProfileId } })).availability).toBe('AVAILABLE');
  expect(await prisma.v2OutboxEvent.count({ where: { assignmentId: world.assignmentId, eventType: 'REQUEST_REOPENED' } })).toBe(0);
  expect(await prisma.v2OutboxEvent.count({ where: { assignmentId: world.assignmentId, eventType: 'BID_ACCEPTED' } })).toBe(1);
}, 30_000);

it('cancels after arrival and refuses cancellation after pickup', async () => {
  const arrived = await acceptedJob();
  await dispatch.progress(arrived.rider, arrived.deliveryId, { status: 'COLLECTING' }, NOW, `collect-${arrived.deliveryId}`);
  await dispatch.cancel(customer, arrived.deliveryId, NOW);
  expect((await prisma.deliveryAssignment.findUnique({ where: { id: arrived.assignmentId } }))?.cancellationStage).toBe('COLLECTING');
  expect((await prisma.delivery.findUnique({ where: { id: arrived.deliveryId } }))?.status).toBe('CANCELLED');

  const picked = await acceptedJob();
  await dispatch.progress(picked.rider, picked.deliveryId, { status: 'COLLECTING' }, NOW, `collect-${picked.deliveryId}`);
  await dispatch.progress(picked.rider, picked.deliveryId, { status: 'COLLECTED' }, NOW, `collected-${picked.deliveryId}`);
  await expect(dispatch.cancel(customer, picked.deliveryId, NOW)).rejects.toThrow('This delivery cannot be cancelled');
  expect((await prisma.deliveryAssignment.findUnique({ where: { id: picked.assignmentId } }))?.status).toBe('ACCEPTED');
  expect((await prisma.walletFeeReservation.findFirst({ where: { assignmentId: picked.assignmentId } }))?.status).toBe('OPEN');
  expect((await prisma.bid.findUnique({ where: { id: picked.bidId } }))?.closedAt).toBeNull();
}, 30_000);

it('reopens on rider cancellation and closes on customer cancellation', async () => {
  const riderCancelled = await acceptedJob();
  const reopened = await dispatch.cancelBeforePickup(riderCancelled.rider, riderCancelled.assignmentId, `rider-${riderCancelled.assignmentId}`, { reason: 'BREAKDOWN' }, NOW);
  expect(reopened).toMatchObject({ status: 'CREATED', reopened: true });
  expect((await prisma.delivery.findUnique({ where: { id: riderCancelled.deliveryId } }))?.price).toBeNull();
  expect(await prisma.v2OutboxEvent.count({ where: { assignmentId: riderCancelled.assignmentId, eventType: 'REQUEST_REOPENED' } })).toBe(1);
  const replay = await dispatch.cancelBeforePickup(riderCancelled.rider, riderCancelled.assignmentId, `rider-${riderCancelled.assignmentId}`, { reason: 'BREAKDOWN' }, NOW);
  expect(replay.replayed).toBe(true);
  expect(await prisma.v2OutboxEvent.count({ where: { assignmentId: riderCancelled.assignmentId, eventType: 'REQUEST_REOPENED' } })).toBe(1);

  const customerCancelled = await acceptedJob();
  await dispatch.cancel(customer, customerCancelled.deliveryId, NOW);
  expect((await prisma.delivery.findUnique({ where: { id: customerCancelled.deliveryId } }))?.status).toBe('CANCELLED');
  expect(await prisma.v2OutboxEvent.count({ where: { assignmentId: customerCancelled.assignmentId, eventType: 'REQUEST_REOPENED' } })).toBe(0);
}, 30_000);

it('keeps one outbox row across an acceptance replay and rolls a failed accept back', async () => {
  const hired = await hireRider();
  const delivery = await openDelivery();
  const bid = await prisma.bid.create({
    data: { deliveryId: delivery.id, riderProfileId: hired.rider.riderProfileId, amount: '10.00', currency: 'USD', status: 'OPEN' },
  });
  const first = await acceptance.accept(customer, delivery.id, bid.id, `accept-${delivery.id}`, NOW);
  const replay = await acceptance.accept(customer, delivery.id, bid.id, `accept-${delivery.id}`, NOW);
  expect(replay).toMatchObject({ assignmentId: first.assignmentId, bidId: bid.id, replayed: true });
  expect(await prisma.v2OutboxEvent.count({ where: { assignmentId: first.assignmentId, eventType: 'BID_ACCEPTED' } })).toBe(1);
  await expect(prisma.v2OutboxEvent.create({
    data: {
      eventType: 'BID_ACCEPTED',
      deliveryId: delivery.id,
      assignmentId: first.assignmentId,
      riderProfileId: hired.rider.riderProfileId,
    },
  })).rejects.toMatchObject({ code: 'P2002' });

  const broke = await hireRider(false);
  const unpaid = await openDelivery();
  const unpaidBid = await prisma.bid.create({
    data: { deliveryId: unpaid.id, riderProfileId: broke.rider.riderProfileId, amount: '10.00', currency: 'USD', status: 'OPEN' },
  });
  await expect(acceptance.accept(customer, unpaid.id, unpaidBid.id, `unpaid-${unpaid.id}`, NOW))
    .rejects.toThrow('Wallet capacity is not enough for this bid');
  expect(await prisma.deliveryAssignment.count({ where: { deliveryId: unpaid.id } })).toBe(0);
  expect(await prisma.v2OutboxEvent.count({ where: { deliveryId: unpaid.id } })).toBe(0);

  await expect(prisma.$transaction(async (tx) => {
    await tx.v2OutboxEvent.create({
      data: {
        eventType: 'REQUEST_REOPENED',
        deliveryId: delivery.id,
        assignmentId: first.assignmentId,
        customerAccountId: customer.customerAccountId,
      },
    });
    throw new Error('rollback outbox');
  })).rejects.toThrow('rollback outbox');
  expect(await prisma.v2OutboxEvent.count({ where: { assignmentId: first.assignmentId, eventType: 'REQUEST_REOPENED' } })).toBe(0);
}, 30_000);

it('returns the original bid id after the assignment is released', async () => {
  const world = await acceptedJob();
  await dispatch.cancel(customer, world.deliveryId, NOW);
  const replay = await acceptance.accept(customer, world.deliveryId, world.bidId, `accept-${world.deliveryId}`, NOW);
  expect(replay).toMatchObject({ bidId: world.bidId, assignmentId: world.assignmentId, replayed: true });
  expect(await prisma.deliveryAssignment.count({ where: { deliveryId: world.deliveryId } })).toBe(1);
  expect((await prisma.deliveryAssignment.findUnique({ where: { id: world.assignmentId } }))?.status).toBe('RELEASED');
  expect((await prisma.walletFeeReservation.findFirst({ where: { assignmentId: world.assignmentId } }))?.status).toBe('RELEASED');
  expect((await prisma.bid.findUnique({ where: { id: world.bidId } }))?.closedAt).not.toBeNull();
}, 30_000);

it('closes an unassigned request at the deadline and leaves an accepted request active', async () => {
  const hired = await hireRider();
  const idle = await openDelivery();
  const idleBid = await prisma.bid.create({
    data: { deliveryId: idle.id, riderProfileId: hired.rider.riderProfileId, amount: '8.00', currency: 'USD', status: 'OPEN' },
  });
  await bids.listOpenRequests(DEADLINE);
  expect((await prisma.delivery.findUnique({ where: { id: idle.id } }))?.status).toBe('CANCELLED');
  expect((await prisma.bid.findUnique({ where: { id: idleBid.id } }))?.status).toBe('EXPIRED');
  await expect(acceptance.accept(customer, idle.id, idleBid.id, `late-${idle.id}`, DEADLINE)).rejects.toThrow('The bidding window has closed');

  const live = await acceptedJob();
  await bids.listOpenRequests(DEADLINE);
  expect((await prisma.delivery.findUnique({ where: { id: live.deliveryId } }))?.status).toBe('RIDER_ASSIGNED');
  expect(await prisma.deliveryAssignment.count({ where: { deliveryId: live.deliveryId, status: 'ACCEPTED' } })).toBe(1);
}, 30_000);

it('lets expiry and acceptance produce one outcome', async () => {
  const hired = await hireRider();
  const delivery = await openDelivery();
  const bid = await prisma.bid.create({
    data: { deliveryId: delivery.id, riderProfileId: hired.rider.riderProfileId, amount: '10.00', currency: 'USD', status: 'OPEN' },
  });
  await Promise.allSettled([
    acceptance.accept(customer, delivery.id, bid.id, `race-${delivery.id}`, NOW),
    bids.listOpenRequests(DEADLINE),
  ]);
  const stored = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
  const acceptedCount = await prisma.deliveryAssignment.count({ where: { deliveryId: delivery.id, status: 'ACCEPTED' } });
  if (stored.status === 'CANCELLED') {
    expect(acceptedCount).toBe(0);
    expect((await prisma.bid.findUnique({ where: { id: bid.id } }))?.status).toBe('EXPIRED');
    expect(await prisma.v2OutboxEvent.count({ where: { deliveryId: delivery.id } })).toBe(0);
  } else {
    expect(stored.status).toBe('RIDER_ASSIGNED');
    expect(acceptedCount).toBe(1);
    expect(await prisma.v2OutboxEvent.count({ where: { deliveryId: delivery.id, eventType: 'BID_ACCEPTED' } })).toBe(1);
  }
}, 30_000);

async function acceptedJob() {
  const hired = await hireRider();
  const delivery = await openDelivery();
  const bid = await prisma.bid.create({
    data: { deliveryId: delivery.id, riderProfileId: hired.rider.riderProfileId, amount: '10.00', currency: 'USD', status: 'OPEN' },
  });
  const accepted = await acceptance.accept(customer, delivery.id, bid.id, `accept-${delivery.id}`, NOW);
  return { ...hired, deliveryId: delivery.id, bidId: bid.id, assignmentId: accepted.assignmentId };
}

async function openDelivery() {
  return prisma.delivery.create({
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
}

async function hireRider(withWallet = true) {
  const user = await prisma.user.create({
    data: { fullName: 'Rider', phone: nextPhone(), role: UserRole.RIDER, accountStatus: 'ACTIVE', phoneVerifiedAt: NOW },
  });
  const profile = await prisma.riderProfile.create({
    data: {
      userId: user.id, verificationStatus: 'VERIFIED', approvalStatus: 'APPROVED', availability: 'AVAILABLE', receivingRequests: true,
      licenceNumber: `LIC${nextRegistration()}`, licenceClass: '4', verifiedAt: NOW, reviewerId: adminId,
    },
  });
  await prisma.motorcycle.create({
    data: {
      riderProfileId: profile.id, registrationNumber: `R${nextRegistration()}`, make: 'Honda', model: 'Ace', colour: 'Red',
      verificationStatus: 'VERIFIED', isActive: true, verifiedAt: NOW, verifiedById: adminId,
    },
  });
  const wallet = withWallet
    ? await prisma.riderWallet.create({ data: { riderProfileId: profile.id, currency: 'USD', balance: '0.00', borrowingLimitOverride: '50.00' } })
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
