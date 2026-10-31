import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { UserRole, WalletEntryType } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DispatchService } from './dispatch.service.js';
import { centsFromDecimal } from './money.js';
import { signedCentsFromDecimal } from '../rider/wallet-money.js';

const exec = promisify(execFile);
const HOST = '127.0.0.1';
const PORT = 54346;
const DATABASE = 'capture_m4';
const CONTAINER = 'riders-m4-capture-pg';
const DISPOSABLE_URL = `postgresql://postgres:postgres@${HOST}:${PORT}/${DATABASE}`;
const NOW = new Date('2026-10-24T12:00:00.000Z');
const PRISMA_CLI = resolve(process.cwd(), 'node_modules/prisma/build/index.js');

let prisma: PrismaService;
let progress: DispatchService;
let customerAccountId = '';
let adminId = '';
let phone = 770010000;
let registration = 2000;
const previousDatabaseUrl = process.env.DATABASE_URL;
const previousSsl = process.env.DATABASE_SSL_CA;

beforeAll(async () => {
  const parsed = new URL(DISPOSABLE_URL);
  if (parsed.hostname !== HOST || parsed.port !== String(PORT) || parsed.pathname !== `/${DATABASE}`) {
    throw new Error('Refusing to use a database that is not the disposable local capture test database');
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
  try {
    await exec(process.execPath, [PRISMA_CLI, 'db', 'push', '--accept-data-loss'], {
      cwd: process.cwd(),
      env: process.env,
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    });
    for (const statement of sqlStatements(readFileSync(new URL('./commission-capture.postgres.sql', import.meta.url), 'utf8'))) {
      await observer.query(statement);
    }
  } finally {
    await observer.end().catch(() => undefined);
  }
  prisma = new PrismaService();
  await prisma.$connect();
  progress = new DispatchService(prisma);
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
  customerAccountId = account.id;
  await prisma.v2CommissionRate.create({
    data: { rateVersion: 1, basisPoints: 1_000, isActive: true, createdById: adminId },
  });
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect().catch(() => undefined);
  await exec('docker', ['rm', '-f', CONTAINER], { windowsHide: true }).catch(() => undefined);
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  if (previousSsl === undefined) delete process.env.DATABASE_SSL_CA;
  else process.env.DATABASE_SSL_CA = previousSsl;
}, 60_000);

it('deducts the snapshotted commission once when the delivery is completed', async () => {
  const world = await readyDelivery();
  await prisma.v2CommissionRate.update({ where: { rateVersion: 1 }, data: { isActive: false } });
  await prisma.v2CommissionRate.create({
    data: { rateVersion: 2, basisPoints: 5_000, isActive: true, createdById: adminId },
  });
  await prisma.delivery.update({ where: { id: world.deliveryId }, data: { suggestedPrice: '99.00' } });
  const completed = await progress.progress(world.rider, world.deliveryId, { status: 'DELIVERED' }, NOW, nextProgressKey(world.deliveryId));
  expect(completed).toMatchObject({ status: 'DELIVERED', availability: 'BUSY' });
  const assignment = await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: world.assignmentId } });
  const reservation = await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: world.assignmentId } });
  const entries = await prisma.riderWalletEntry.findMany({ where: { riderWalletId: world.walletId } });
  const wallet = await prisma.riderWallet.findUniqueOrThrow({ where: { id: world.walletId } });
  expect(assignment.status).toBe('COMPLETED');
  expect(assignment.acceptedCommissionBasisPoints).toBe(1_000);
  expect(centsFromDecimal(assignment.acceptedCommissionAmount!)).toBe(100);
  expect(reservation).toMatchObject({ status: 'CAPTURED', configVersion: 1 });
  expect(centsFromDecimal(reservation.amount)).toBe(100);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    entryType: 'PLATFORM_FEE',
    idempotencyKey: `platform-fee:assignment:${world.assignmentId}`,
    configVersion: 1,
    actorType: 'SYSTEM',
    actorId: null,
  });
  expect(signedCentsFromDecimal(entries[0]!.amount)).toBe(-100);
  expect(signedCentsFromDecimal(wallet.balance)).toBe(-100);
  await expect(prisma.riderWalletEntry.update({ where: { id: entries[0]!.id }, data: { amount: '-2.00' } })).rejects.toThrow(/append-only/);
  await prisma.v2CommissionRate.create({
    data: { rateVersion: 3, basisPoints: 7_500, isActive: false, createdById: adminId },
  });
  const after = await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: world.assignmentId } });
  expect(after.acceptedCommissionBasisPoints).toBe(1_000);
  expect(await prisma.riderWalletEntry.count({ where: { entryType: WalletEntryType.PLATFORM_FEE, riderWalletId: world.walletId } })).toBe(1);
});

it('rejects a repeated completion without a second deduction', async () => {
  const world = await readyDelivery();
  await progress.progress(world.rider, world.deliveryId, { status: 'DELIVERED' }, NOW, nextProgressKey(world.deliveryId));
  await expect(progress.progress(world.rider, world.deliveryId, { status: 'DELIVERED' }, new Date('2026-10-24T13:00:00.000Z'), nextProgressKey(world.deliveryId)))
    .rejects.toThrow('Delivery not found');
  expect(await prisma.riderWalletEntry.count({ where: { riderWalletId: world.walletId, entryType: 'PLATFORM_FEE' } })).toBe(1);
  expect(await prisma.walletFeeReservation.count({ where: { assignmentId: world.assignmentId, status: 'CAPTURED' } })).toBe(1);
});

it('lets one of two concurrent completions deduct the commission', async () => {
  const world = await readyDelivery();
  const results = await Promise.allSettled([
    progress.progress(world.rider, world.deliveryId, { status: 'DELIVERED' }, NOW, nextProgressKey(world.deliveryId)),
    progress.progress(world.rider, world.deliveryId, { status: 'DELIVERED' }, NOW, nextProgressKey(world.deliveryId)),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  expect(await prisma.riderWalletEntry.count({ where: { riderWalletId: world.walletId, entryType: 'PLATFORM_FEE' } })).toBe(1);
  expect(await prisma.deliveryAssignment.count({ where: { id: world.assignmentId, status: 'COMPLETED' } })).toBe(1);
  expect((await prisma.delivery.findUnique({ where: { id: world.deliveryId } }))?.status).toBe('DELIVERED');
});

it('refuses a missing reservation and an amount mismatch without completing the delivery', async () => {
  const missing = await readyDelivery({ reservation: false });
  await expect(progress.progress(missing.rider, missing.deliveryId, { status: 'DELIVERED' }, NOW, nextProgressKey(missing.deliveryId)))
    .rejects.toThrow('This commission reservation was not found');
  expect((await prisma.delivery.findUnique({ where: { id: missing.deliveryId } }))?.status).toBe('OUT_FOR_DELIVERY');
  expect((await prisma.deliveryAssignment.findUnique({ where: { id: missing.assignmentId } }))?.status).toBe('ACCEPTED');
  expect(await prisma.riderWalletEntry.count({ where: { riderWalletId: missing.walletId } })).toBe(0);

  const mismatched = await readyDelivery({ reservationCents: 200 });
  await expect(progress.progress(mismatched.rider, mismatched.deliveryId, { status: 'DELIVERED' }, NOW, nextProgressKey(mismatched.deliveryId)))
    .rejects.toThrow('This commission reservation does not match the accepted bid');
  expect((await prisma.delivery.findUnique({ where: { id: mismatched.deliveryId } }))?.status).toBe('OUT_FOR_DELIVERY');
  expect((await prisma.walletFeeReservation.findFirst({ where: { assignmentId: mismatched.assignmentId } }))?.status).toBe('OPEN');
  expect(await prisma.riderWalletEntry.count({ where: { riderWalletId: mismatched.walletId } })).toBe(0);
  expect((await prisma.riderProfile.findUnique({ where: { id: mismatched.rider.riderProfileId } }))?.availability).toBe('BUSY');
});

it('rolls the completion back when the ledger insert fails', async () => {
  const world = await readyDelivery();
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION "fail_v2_fee_insert"()
    RETURNS trigger LANGUAGE plpgsql AS $fail$
    BEGIN
      IF NEW."entry_type" = 'PLATFORM_FEE' THEN
        RAISE EXCEPTION 'ledger insert failed';
      END IF;
      RETURN NEW;
    END;
    $fail$
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "fail_v2_fee_insert"
    BEFORE INSERT ON "rider_wallet_entries"
    FOR EACH ROW EXECUTE FUNCTION "fail_v2_fee_insert"()
  `);
  try {
    await expect(progress.progress(world.rider, world.deliveryId, { status: 'DELIVERED' }, NOW, nextProgressKey(world.deliveryId))).rejects.toThrow(/ledger insert failed/);
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "fail_v2_fee_insert" ON "rider_wallet_entries"');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS "fail_v2_fee_insert"()');
  }
  expect((await prisma.delivery.findUnique({ where: { id: world.deliveryId } }))?.status).toBe('OUT_FOR_DELIVERY');
  expect((await prisma.deliveryAssignment.findUnique({ where: { id: world.assignmentId } }))?.status).toBe('ACCEPTED');
  expect((await prisma.walletFeeReservation.findFirst({ where: { assignmentId: world.assignmentId } }))?.status).toBe('OPEN');
  expect(await prisma.riderWalletEntry.count({ where: { riderWalletId: world.walletId } })).toBe(0);
  expect(signedCentsFromDecimal((await prisma.riderWallet.findUniqueOrThrow({ where: { id: world.walletId } })).balance)).toBe(0);
  expect((await prisma.riderProfile.findUnique({ where: { id: world.rider.riderProfileId } }))?.availability).toBe('BUSY');
});

it('completes a 0% snapshot with no wallet and does not charge after a later rate increase', async () => {
  const active = await prisma.v2CommissionRate.findFirstOrThrow({ where: { isActive: true } });
  if (active.basisPoints !== 0) {
    await prisma.v2CommissionRate.update({ where: { id: active.id }, data: { isActive: false } });
    const highest = await prisma.v2CommissionRate.findFirstOrThrow({ orderBy: { rateVersion: 'desc' } });
    await prisma.v2CommissionRate.create({
      data: { rateVersion: highest.rateVersion + 1, basisPoints: 0, isActive: true, createdById: adminId },
    });
  }
  const zeroRate = await prisma.v2CommissionRate.findFirstOrThrow({ where: { isActive: true } });
  const world = await readyDelivery({
    wallet: false,
    basisPoints: 0,
    commissionCents: 0,
    rateVersion: zeroRate.rateVersion,
    reservation: false,
  });
  const completed = await progress.progress(world.rider, world.deliveryId, { status: 'DELIVERED' }, NOW, nextProgressKey(world.deliveryId));
  expect(completed).toMatchObject({ status: 'DELIVERED', availability: 'BUSY' });
  expect(await prisma.riderWallet.count({ where: { riderProfileId: world.rider.riderProfileId } })).toBe(0);
  expect(await prisma.walletFeeReservation.count({ where: { assignmentId: world.assignmentId } })).toBe(0);
  expect(await prisma.riderWalletEntry.count({ where: { idempotencyKey: `platform-fee:assignment:${world.assignmentId}` } })).toBe(0);
  const highest = await prisma.v2CommissionRate.findFirstOrThrow({ orderBy: { rateVersion: 'desc' } });
  await prisma.v2CommissionRate.update({ where: { id: zeroRate.id }, data: { isActive: false } });
  await prisma.v2CommissionRate.create({
    data: { rateVersion: highest.rateVersion + 1, basisPoints: 4_000, isActive: true, createdById: adminId },
  });
  const assignment = await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: world.assignmentId } });
  expect(assignment.acceptedCommissionBasisPoints).toBe(0);
  expect(centsFromDecimal(assignment.acceptedCommissionAmount!)).toBe(0);
  const chargedForThis = await prisma.riderWalletEntry.count({
    where: { idempotencyKey: `platform-fee:assignment:${world.assignmentId}` },
  });
  expect(chargedForThis).toBe(0);
});

it('does not deduct a commission for a failed or skipped completion', async () => {
  const world = await readyDelivery();
  await expect(progress.progress(world.rider, world.deliveryId, { status: 'FAILED' }, NOW, nextProgressKey(world.deliveryId))).rejects.toThrow('This delivery status cannot be changed');
  await expect(progress.progress(world.rider, world.deliveryId, { status: 'CANCELLED' }, NOW, nextProgressKey(world.deliveryId))).rejects.toThrow('This delivery status cannot be changed');
  expect((await prisma.delivery.findUnique({ where: { id: world.deliveryId } }))?.status).toBe('OUT_FOR_DELIVERY');
  expect((await prisma.walletFeeReservation.findFirst({ where: { assignmentId: world.assignmentId } }))?.status).toBe('OPEN');
  expect(await prisma.riderWalletEntry.count({ where: { riderWalletId: world.walletId } })).toBe(0);
});

async function readyDelivery(options?: {
  wallet?: boolean;
  reservation?: boolean;
  reservationCents?: number;
  basisPoints?: number;
  commissionCents?: number;
  rateVersion?: number;
}) {
  const user = await prisma.user.create({
    data: { fullName: 'Rider', phone: nextPhone(), role: UserRole.RIDER, accountStatus: 'ACTIVE', phoneVerifiedAt: NOW },
  });
  const profile = await prisma.riderProfile.create({
    data: {
      userId: user.id,
      verificationStatus: 'VERIFIED',
      approvalStatus: 'APPROVED',
      availability: 'BUSY',
      licenceNumber: `LIC${nextRegistration()}`,
      licenceClass: '4',
      verifiedAt: NOW,
      reviewerId: adminId,
    },
  });
  const motorcycle = await prisma.motorcycle.create({
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
  const withWallet = options?.wallet !== false;
  const wallet = withWallet
    ? await prisma.riderWallet.create({
      data: { riderProfileId: profile.id, currency: 'USD', balance: '0.00', borrowingLimitOverride: '50.00' },
    })
    : null;
  const delivery = await prisma.delivery.create({
    data: {
      customerId: customerAccountId,
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
      deliverBy: new Date('2026-10-24T18:00:00.000Z'),
      status: 'OUT_FOR_DELIVERY',
      searchGeneration: 0,
    },
  });
  const basisPoints = options?.basisPoints ?? 1_000;
  const commissionCents = options?.commissionCents ?? 100;
  const rateVersion = options?.rateVersion ?? 1;
  const assignment = await prisma.deliveryAssignment.create({
    data: {
      deliveryId: delivery.id,
      riderProfileId: profile.id,
      motorcycleId: motorcycle.id,
      status: 'ACCEPTED',
      offerExpiresAt: new Date('2026-10-24T18:00:00.000Z'),
      respondedAt: NOW,
      serviceClass: 'EXPRESS',
      acceptedBidAmount: '10.00',
      acceptedCommissionBasisPoints: basisPoints,
      acceptedV2CommissionRateVersion: rateVersion,
      acceptedCommissionAmount: (commissionCents / 100).toFixed(2),
      acceptedPlatformFee: null,
      acceptedFeeConfigVersion: null,
    },
  });
  if (options?.reservation !== false && wallet) {
    const reserved = options?.reservationCents ?? commissionCents;
    await prisma.walletFeeReservation.create({
      data: {
        riderWalletId: wallet.id,
        deliveryId: delivery.id,
        assignmentId: assignment.id,
        amount: (reserved / 100).toFixed(2),
        promotionalAmount: '0.00',
        walletAmount: (reserved / 100).toFixed(2),
        currency: 'USD',
        configVersion: rateVersion,
        status: 'OPEN',
      },
    });
  }
  return {
    rider: { userId: user.id, riderProfileId: profile.id },
    deliveryId: delivery.id,
    assignmentId: assignment.id,
    walletId: wallet?.id ?? '',
  };
}

let progressSequence = 0;

function nextProgressKey(deliveryId: string): string {
  progressSequence += 1;
  return `capture-${deliveryId}-${progressSequence}`;
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
