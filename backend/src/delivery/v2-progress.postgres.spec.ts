import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { UserRole, WalletEntryType } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BidAcceptanceService } from './bid-acceptance.service.js';
import { DispatchService } from './dispatch.service.js';
import { signedCentsFromDecimal } from '../rider/wallet-money.js';

const exec = promisify(execFile);
const HOST = '127.0.0.1';
const PORT = 54347;
const DATABASE = 'progress_m4';
const CONTAINER = 'riders-m4-progress-pg';
const DISPOSABLE_URL = `postgresql://postgres:postgres@${HOST}:${PORT}/${DATABASE}`;
const NOW = new Date('2026-10-24T08:00:00.000Z');
const DEADLINE = new Date('2026-10-24T18:00:00.000Z');
const PRISMA_CLI = resolve(process.cwd(), 'node_modules/prisma/build/index.js');
const STEPS = ['COLLECTING', 'COLLECTED', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const;

let prisma: PrismaService;
let acceptance: BidAcceptanceService;
let dispatch: DispatchService;
let customer: { userId: string; role: typeof UserRole.CUSTOMER; customerAccountId: string };
let adminId = '';
let phone = 770020000;
let registration = 3000;
const previousDatabaseUrl = process.env.DATABASE_URL;
const previousFlag = process.env.V2_MARKETPLACE_ENABLED;
const previousSsl = process.env.DATABASE_SSL_CA;

beforeAll(async () => {
  const parsed = new URL(DISPOSABLE_URL);
  if (parsed.hostname !== HOST || parsed.port !== String(PORT) || parsed.pathname !== `/${DATABASE}`) {
    throw new Error('Refusing to use a database that is not the disposable local progression test database');
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
    const sql = readFileSync(new URL('./commission-capture.postgres.sql', import.meta.url), 'utf8');
    for (const statement of sqlStatements(sql)) {
      await observer.query(statement);
    }
  } finally {
    await observer.end().catch(() => undefined);
  }
  prisma = new PrismaService();
  await prisma.$connect();
  acceptance = new BidAcceptanceService(prisma);
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

it('progresses an accepted V2 delivery through the native chain and deducts the commission once', async () => {
  const world = await acceptedDelivery();
  const stored = await prisma.delivery.findUniqueOrThrow({ where: { id: world.deliveryId } });
  const assignment = await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: world.assignmentId } });
  expect(stored.status).toBe('RIDER_ASSIGNED');
  expect(assignment.status).toBe('ACCEPTED');

  const active = await dispatch.activeAssignment(world.rider, NOW);
  expect(active.assignment).toMatchObject({
    assignmentId: world.assignmentId,
    deliveryId: world.deliveryId,
    status: 'RIDER_ASSIGNED',
  });

  await expect(dispatch.progress(world.otherRider, world.deliveryId, { status: 'COLLECTING' }, NOW))
    .rejects.toThrow('Delivery not found');
  await expect(dispatch.progress(
    { userId: world.otherRider.userId, riderProfileId: world.rider.riderProfileId },
    world.deliveryId,
    { status: 'COLLECTING' },
    NOW,
    'wrong-user',
  )).rejects.toThrow('Rider access is required');
  await expect(dispatch.progress(world.rider, world.deliveryId, { status: 'COLLECTED' }, NOW, 'skip'))
    .rejects.toThrow('This delivery status cannot be changed');
  await expect(dispatch.release(world.rider, world.assignmentId, { reason: 'RIDER_CANCELLED' }, NOW))
    .rejects.toThrow('This delivery cannot be released');
  expect((await prisma.delivery.findUnique({ where: { id: world.deliveryId } }))?.status).toBe('RIDER_ASSIGNED');
  expect(await prisma.riderWalletEntry.count({ where: { entryType: WalletEntryType.PLATFORM_FEE } })).toBe(0);

  for (const status of STEPS) {
    const result = await dispatch.progress(world.rider, world.deliveryId, { status }, NOW, `step-${status}`);
    expect(result).toMatchObject({
      deliveryId: world.deliveryId,
      status,
      availability: 'AVAILABLE',
    });
    expect((await prisma.delivery.findUnique({ where: { id: world.deliveryId } }))?.status).toBe(status);
  }

  const fees = await prisma.riderWalletEntry.findMany({ where: { riderWalletId: world.walletId, entryType: 'PLATFORM_FEE' } });
  expect(fees).toHaveLength(1);
  expect(fees[0]?.idempotencyKey).toBe(`platform-fee:assignment:${world.assignmentId}`);
  expect(signedCentsFromDecimal(fees[0]!.amount)).toBe(-100);
  expect((await prisma.walletFeeReservation.findFirst({ where: { assignmentId: world.assignmentId } }))?.status).toBe('CAPTURED');
  expect((await prisma.deliveryAssignment.findUnique({ where: { id: world.assignmentId } }))?.status).toBe('COMPLETED');

  await expect(dispatch.progress(world.rider, world.deliveryId, { status: 'DELIVERED' }, NOW, 'again')).rejects.toThrow('Delivery not found');
  expect(await prisma.riderWalletEntry.count({ where: { riderWalletId: world.walletId, entryType: 'PLATFORM_FEE' } })).toBe(1);
});

async function acceptedDelivery() {
  const riderUser = await riderUserRow();
  const other = await riderUserRow();
  const profile = await riderProfile(riderUser.id);
  const otherProfile = await riderProfile(other.id);
  const wallet = await prisma.riderWallet.create({
    data: { riderProfileId: profile.id, currency: 'USD', balance: '0.00', borrowingLimitOverride: '50.00' },
  });
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
      currency: 'USD',
      serviceClass: 'EXPRESS',
      deliverBy: DEADLINE,
      status: 'CREATED',
      searchGeneration: 0,
    },
  });
  const bid = await prisma.bid.create({
    data: {
      deliveryId: delivery.id,
      riderProfileId: profile.id,
      amount: '10.00',
      currency: 'USD',
      status: 'OPEN',
    },
  });
  const accepted = await acceptance.accept(customer, delivery.id, bid.id, `accept-${delivery.id}`, NOW);
  return {
    deliveryId: delivery.id,
    assignmentId: accepted.assignmentId,
    walletId: wallet.id,
    rider: { userId: riderUser.id, riderProfileId: profile.id },
    otherRider: { userId: other.id, riderProfileId: otherProfile.id },
  };
}

async function riderUserRow() {
  return prisma.user.create({
    data: { fullName: 'Rider', phone: nextPhone(), role: UserRole.RIDER, accountStatus: 'ACTIVE', phoneVerifiedAt: NOW },
  });
}

async function riderProfile(userId: string) {
  const profile = await prisma.riderProfile.create({
    data: {
      userId,
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
  return profile;
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
