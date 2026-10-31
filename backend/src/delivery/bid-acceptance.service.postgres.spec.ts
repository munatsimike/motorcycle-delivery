import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { UserRole, WalletEntryType } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { V2CommissionRateService } from '../rider/v2-commission-rate.service.js';
import { BidAcceptanceService } from './bid-acceptance.service.js';
import { BidService } from './bid.service.js';
import { commissionCents } from './commission-calculator.js';
import { centsFromDecimal } from './money.js';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const PRISMA_CLI = require.resolve('prisma/build/index.js');
const HOST = '127.0.0.1';
const PORT = 54345;
const DATABASE = 'acceptance_m3_service';
const CONTAINER = 'riders-m3-acceptance-service-pg';
const DISPOSABLE_URL = `postgresql://postgres:postgres@${HOST}:${PORT}/${DATABASE}`;
const NOW = new Date('2026-10-24T08:00:00.000Z');
const DEADLINE = new Date('2026-10-24T18:00:00.000Z');

let prisma: PrismaService;
let acceptance: BidAcceptanceService;
let rates: V2CommissionRateService;
let customer: { userId: string; role: typeof UserRole.CUSTOMER; customerAccountId: string };
let adminId = '';
let phone = 770000100;
let registration = 1000;
const previousDatabaseUrl = process.env.DATABASE_URL;
const previousFlag = process.env.V2_MARKETPLACE_ENABLED;
const previousSsl = process.env.DATABASE_SSL_CA;

beforeAll(async () => {
  const parsed = new URL(DISPOSABLE_URL);
  if (parsed.hostname !== HOST || parsed.port !== String(PORT) || parsed.pathname !== `/${DATABASE}`) {
    throw new Error('Refusing to use a database that is not the disposable local acceptance service database');
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
    for (const statement of sqlStatements(constraintSql)) {
      await observer.query(statement);
    }
  } finally {
    await observer.end().catch(() => undefined);
  }
  prisma = new PrismaService();
  await prisma.$connect();
  acceptance = new BidAcceptanceService(prisma);
  rates = new V2CommissionRateService(prisma);
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
  await setRate(1_000);
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

it('accepts one bid and writes one assignment, one snapshot, and one open reservation', async () => {
  await setRate(1_000);
  const world = await scenario({ competing: true });
  const accepted = await acceptance.accept(customer, world.deliveryId, world.bidId, `accept-${world.deliveryId}`, NOW);
  expect(accepted).toMatchObject({
    reserved: true,
    replayed: false,
    status: 'RIDER_ASSIGNED',
    availability: 'AVAILABLE',
    acceptedBidAmount: '10.00',
    commissionAmount: '1.00',
    basisPoints: 1_000,
  });
  const assignments = await prisma.deliveryAssignment.findMany({ where: { deliveryId: world.deliveryId } });
  const bids = await prisma.bid.findMany({ where: { deliveryId: world.deliveryId } });
  const reservations = await prisma.walletFeeReservation.findMany({ where: { deliveryId: world.deliveryId } });
  const ledger = await prisma.riderWalletEntry.count({ where: { entryType: WalletEntryType.PLATFORM_FEE } });
  expect(assignments).toHaveLength(1);
  expect(assignments[0]).toMatchObject({
    status: 'ACCEPTED',
    acceptedPlatformFee: null,
    acceptedFeeConfigVersion: null,
    serviceClass: 'EXPRESS',
    acceptedCommissionBasisPoints: 1_000,
    acceptedV2CommissionRateVersion: accepted.rateVersion,
  });
  expect(centsFromDecimal(assignments[0]!.acceptedBidAmount!)).toBe(1_000);
  expect(centsFromDecimal(assignments[0]!.acceptedCommissionAmount!)).toBe(100);
  expect(bids.filter((bid) => bid.status === 'ACCEPTED')).toHaveLength(1);
  expect(bids.filter((bid) => bid.status === 'SUPERSEDED')).toHaveLength(1);
  expect(reservations).toHaveLength(1);
  expect(reservations[0]).toMatchObject({ status: 'OPEN', configVersion: accepted.rateVersion });
  expect(centsFromDecimal(reservations[0]!.amount)).toBe(100);
  expect(ledger).toBe(0);
  await expect(prisma.$executeRaw`
    UPDATE "delivery_assignments"
       SET "accepted_commission_amount" = 2.00
     WHERE "id" = CAST(${assignments[0]!.id} AS uuid)
  `).rejects.toThrow(/immutable/);
});

it('treats a simultaneous duplicate idempotency key as one assignment and a replay', async () => {
  await setRate(1_000);
  const world = await scenario();
  const key = `same-${world.deliveryId}`;
  const results = await Promise.all([
    acceptance.accept(customer, world.deliveryId, world.bidId, key, NOW),
    acceptance.accept(customer, world.deliveryId, world.bidId, key, NOW),
  ]);
  expect(results.map((result) => result.assignmentId)).toEqual([results[0]!.assignmentId, results[0]!.assignmentId]);
  expect(results.filter((result) => result.replayed)).toHaveLength(1);
  expect(await prisma.deliveryAssignment.count({ where: { deliveryId: world.deliveryId } })).toBe(1);
  expect(await prisma.walletFeeReservation.count({ where: { deliveryId: world.deliveryId, status: 'OPEN' } })).toBe(1);
  expect(await prisma.riderWalletEntry.count({ where: { entryType: WalletEntryType.PLATFORM_FEE } })).toBe(0);
});

it('lets only one of two bids on the same delivery become accepted', async () => {
  await setRate(1_000);
  const world = await scenario({ competing: true });
  const results = await Promise.allSettled([
    acceptance.accept(customer, world.deliveryId, world.bidId, `bid-a-${world.deliveryId}`, NOW),
    acceptance.accept(customer, world.deliveryId, world.otherBidId!, `bid-b-${world.deliveryId}`, NOW),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  expect(await prisma.deliveryAssignment.count({ where: { deliveryId: world.deliveryId, status: 'ACCEPTED' } })).toBe(1);
  expect(await prisma.bid.count({ where: { deliveryId: world.deliveryId, status: 'ACCEPTED' } })).toBe(1);
  expect(await prisma.walletFeeReservation.count({ where: { deliveryId: world.deliveryId, status: 'OPEN' } })).toBe(1);
});

it('accepts a second delivery for a rider who is already accepted', async () => {
  await setRate(1_000);
  const first = await scenario();
  const second = await scenario({ riderId: first.riderId, wallet: false });
  await acceptance.accept(customer, first.deliveryId, first.bidId, `first-${first.deliveryId}`, NOW);
  await acceptance.accept(customer, second.deliveryId, second.bidId, `second-${second.deliveryId}`, NOW);
  expect(await prisma.deliveryAssignment.count({ where: { riderProfileId: first.riderId, status: 'ACCEPTED' } })).toBe(2);
  const assigned = await prisma.delivery.findUnique({ where: { id: second.deliveryId } });
  const bid = await prisma.bid.findUnique({ where: { id: second.bidId } });
  expect(assigned?.status).toBe('RIDER_ASSIGNED');
  expect(bid?.status).toBe('ACCEPTED');
});

it('keeps concurrent reservations within the rider wallet capacity', async () => {
  await setRate(1_000);
  const first = await scenario({ borrowingLimit: '1.00' });
  const second = await scenario({ riderId: first.riderId, wallet: false });
  const results = await Promise.allSettled([
    acceptance.accept(customer, first.deliveryId, first.bidId, `cap-a-${first.deliveryId}`, NOW),
    acceptance.accept(customer, second.deliveryId, second.bidId, `cap-b-${second.deliveryId}`, NOW),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const reserved = await prisma.walletFeeReservation.findMany({
    where: { riderWalletId: first.walletId, status: 'OPEN' },
  });
  const reservedCents = reserved.reduce((sum, row) => sum + centsFromDecimal(row.amount), 0);
  expect(reserved).toHaveLength(1);
  expect(reservedCents).toBeLessThanOrEqual(100);
  expect(await prisma.deliveryAssignment.count({ where: { riderProfileId: first.riderId, status: 'ACCEPTED' } })).toBe(1);
});

it('rolls back the assignment and bid writes when the reservation insert fails', async () => {
  await setRate(1_000);
  const world = await scenario({ competing: true });
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION "fail_v2_reservation_insert"()
    RETURNS trigger LANGUAGE plpgsql AS $fail$
    BEGIN
      RAISE EXCEPTION 'reservation failed';
    END;
    $fail$
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "fail_v2_reservation_insert"
    BEFORE INSERT ON "wallet_fee_reservations"
    FOR EACH ROW EXECUTE FUNCTION "fail_v2_reservation_insert"()
  `);
  try {
    await expect(acceptance.accept(customer, world.deliveryId, world.bidId, `rollback-${world.deliveryId}`, NOW))
      .rejects.toThrow(/reservation failed/);
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "fail_v2_reservation_insert" ON "wallet_fee_reservations"');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS "fail_v2_reservation_insert"()');
  }
  expect(await prisma.deliveryAssignment.count({ where: { deliveryId: world.deliveryId } })).toBe(0);
  expect(await prisma.walletFeeReservation.count({ where: { riderWalletId: world.walletId } })).toBe(0);
  const bids = await prisma.bid.findMany({ where: { deliveryId: world.deliveryId } });
  expect(bids.every((bid) => bid.status === 'OPEN')).toBe(true);
  const delivery = await prisma.delivery.findUnique({ where: { id: world.deliveryId } });
  const rider = await prisma.riderProfile.findUnique({ where: { id: world.riderId } });
  expect(delivery?.status).toBe('CREATED');
  expect(delivery?.price).toBeNull();
  expect(rider?.availability).toBe('AVAILABLE');
});

it('keeps the commission snapshot consistent with the rate version committed during a publication race', async () => {
  await setRate(1_000);
  const world = await scenario();
  const before = await prisma.v2CommissionRate.findFirstOrThrow({ where: { isActive: true } });
  const [accepted] = await Promise.all([
    acceptance.accept(customer, world.deliveryId, world.bidId, `race-rate-${world.deliveryId}`, NOW),
    rates.publish({ userId: adminId }, { percentage: '25' }, NOW),
  ]);
  const assignment = await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: accepted.assignmentId } });
  const snapshotted = await prisma.v2CommissionRate.findUniqueOrThrow({ where: { rateVersion: assignment.acceptedV2CommissionRateVersion! } });
  expect(assignment.acceptedCommissionBasisPoints).toBe(snapshotted.basisPoints);
  expect(centsFromDecimal(assignment.acceptedCommissionAmount!)).toBe(commissionCents(1_000, snapshotted.basisPoints));
  expect([before.basisPoints, 2_500]).toContain(snapshotted.basisPoints);
  const published = await rates.publish({ userId: adminId }, { percentage: '40' }, NOW);
  const after = await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: accepted.assignmentId } });
  expect(after.acceptedCommissionBasisPoints).toBe(assignment.acceptedCommissionBasisPoints);
  expect(centsFromDecimal(after.acceptedCommissionAmount!)).toBe(centsFromDecimal(assignment.acceptedCommissionAmount!));
  expect(after.acceptedV2CommissionRateVersion).toBe(assignment.acceptedV2CommissionRateVersion);
  expect(published.basisPoints).toBe(4_000);
});

it('accepts a published 0% rate without a wallet or a reservation', async () => {
  await setRate(0);
  const world = await scenario({ wallet: false });
  const accepted = await acceptance.accept(customer, world.deliveryId, world.bidId, `zero-${world.deliveryId}`, NOW);
  expect(accepted).toMatchObject({ commissionAmount: '0.00', basisPoints: 0, reserved: false, replayed: false });
  expect(await prisma.riderWallet.count({ where: { riderProfileId: world.riderId } })).toBe(0);
  expect(await prisma.walletFeeReservation.count({ where: { deliveryId: world.deliveryId } })).toBe(0);
  expect(await prisma.riderWalletEntry.count()).toBe(0);
  expect(await prisma.deliveryAssignment.count({ where: { deliveryId: world.deliveryId, status: 'ACCEPTED' } })).toBe(1);
});

it('rejects an expired bid and a withdrawn bid', async () => {
  await setRate(1_000);
  const expired = await scenario({ deliverBy: new Date(NOW.getTime() - 60_000) });
  await expect(acceptance.accept(customer, expired.deliveryId, expired.bidId, `expired-${expired.deliveryId}`, NOW))
    .rejects.toThrow('The bidding window has closed');
  expect((await prisma.bid.findUnique({ where: { id: expired.bidId } }))?.status).toBe('EXPIRED');
  expect(await prisma.deliveryAssignment.count({ where: { deliveryId: expired.deliveryId } })).toBe(0);

  const withdrawn = await scenario({ bidStatus: 'WITHDRAWN' });
  await expect(acceptance.accept(customer, withdrawn.deliveryId, withdrawn.bidId, `withdrawn-${withdrawn.deliveryId}`, NOW))
    .rejects.toThrow('This bid is not open');
  expect((await prisma.bid.findUnique({ where: { id: withdrawn.bidId } }))?.status).toBe('WITHDRAWN');
  expect((await prisma.delivery.findUnique({ where: { id: withdrawn.deliveryId } }))?.status).toBe('CREATED');
});

it('lists only the signed-in rider bids, newest first, one page at a time', async () => {
  const riderId = await createRider();
  const otherRiderId = await createRider();
  await prisma.riderWallet.create({
    data: { riderProfileId: riderId, currency: 'USD', balance: '0.00', borrowingLimitOverride: '50.00' },
  });
  await prisma.riderWallet.create({
    data: { riderProfileId: otherRiderId, currency: 'USD', balance: '0.00', borrowingLimitOverride: '50.00' },
  });
  const oldest = await scenario({ riderId });
  const middle = await scenario({ riderId, wallet: false });
  const newest = await scenario({ riderId, wallet: false });
  const foreign = await scenario({ riderId: otherRiderId, wallet: false });
  await prisma.bid.update({ where: { id: oldest.bidId }, data: { createdAt: new Date('2026-10-24T07:00:00.000Z') } });
  await prisma.bid.update({ where: { id: middle.bidId }, data: { createdAt: new Date('2026-10-24T08:00:00.000Z') } });
  await prisma.bid.update({ where: { id: newest.bidId }, data: { createdAt: new Date('2026-10-24T09:00:00.000Z') } });
  await prisma.bid.update({ where: { id: foreign.bidId }, data: { createdAt: new Date('2026-10-24T10:00:00.000Z') } });
  const bids = new BidService(prisma);
  const first = await bids.listOwn({ userId: 'user-rider', riderProfileId: riderId }, { limit: '2' }, NOW);
  expect(first.bids.map((bid) => bid.bidId)).toEqual([newest.bidId, middle.bidId]);
  expect(first.bids[0]).toMatchObject({
    deliveryId: newest.deliveryId,
    amount: '10.00',
    currency: 'USD',
    status: 'OPEN',
    serviceClass: 'EXPRESS',
    pickupAddress: 'Pickup',
    dropoffAddress: 'Dropoff',
  });
  expect(first.nextCursor).toEqual(expect.any(String));
  expect(JSON.stringify(first)).not.toContain(foreign.bidId);
  expect(JSON.stringify(first)).not.toContain('pickupContactPhone');
  const second = await bids.listOwn(
    { userId: 'user-rider', riderProfileId: riderId },
    { limit: '2', cursor: first.nextCursor },
    NOW,
  );
  expect(second.bids.map((bid) => bid.bidId)).toEqual([oldest.bidId]);
  expect(second.nextCursor).toBeNull();
});

it('leaves the delivery and bids unchanged when wallet capacity is short', async () => {
  await setRate(1_000);
  const world = await scenario({ competing: true, borrowingLimit: '0.00' });
  await expect(acceptance.accept(customer, world.deliveryId, world.bidId, `short-${world.deliveryId}`, NOW))
    .rejects.toThrow('Wallet capacity is not enough for this bid');
  const delivery = await prisma.delivery.findUnique({ where: { id: world.deliveryId } });
  const bids = await prisma.bid.findMany({ where: { deliveryId: world.deliveryId } });
  expect(delivery?.status).toBe('CREATED');
  expect(delivery?.price).toBeNull();
  expect(bids.every((bid) => bid.status === 'OPEN')).toBe(true);
  expect(await prisma.deliveryAssignment.count({ where: { deliveryId: world.deliveryId } })).toBe(0);
  expect(await prisma.walletFeeReservation.count({ where: { riderWalletId: world.walletId } })).toBe(0);
  expect(await prisma.riderWalletEntry.count({ where: { entryType: WalletEntryType.PLATFORM_FEE } })).toBe(0);
});

async function setRate(basisPoints: number) {
  const active = await prisma.v2CommissionRate.findFirst({ where: { isActive: true } });
  if (active?.basisPoints === basisPoints) {
    return active;
  }
  const highest = await prisma.v2CommissionRate.findFirst({ orderBy: { rateVersion: 'desc' } });
  if (active) {
    await prisma.v2CommissionRate.update({ where: { id: active.id }, data: { isActive: false } });
  }
  return prisma.v2CommissionRate.create({
    data: {
      rateVersion: (highest?.rateVersion ?? 0) + 1,
      basisPoints,
      isActive: true,
      createdById: adminId,
    },
  });
}

async function scenario(options?: {
  competing?: boolean;
  riderId?: string;
  wallet?: boolean;
  borrowingLimit?: string;
  deliverBy?: Date;
  bidStatus?: 'OPEN' | 'WITHDRAWN';
}) {
  const riderId = options?.riderId ?? await createRider();
  let walletId = '';
  if (options?.wallet !== false && !options?.riderId) {
    const wallet = await prisma.riderWallet.create({
      data: {
        riderProfileId: riderId,
        currency: 'USD',
        balance: '0.00',
        borrowingLimitOverride: options?.borrowingLimit ?? '50.00',
      },
    });
    walletId = wallet.id;
  } else if (options?.riderId) {
    const wallet = await prisma.riderWallet.findUniqueOrThrow({ where: { riderProfileId: riderId } });
    walletId = wallet.id;
    if (options.borrowingLimit) {
      await prisma.riderWallet.update({
        where: { id: wallet.id },
        data: { borrowingLimitOverride: options.borrowingLimit },
      });
    }
  }
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
      deliverBy: options?.deliverBy ?? DEADLINE,
      status: 'CREATED',
      searchGeneration: 0,
    },
  });
  const bid = await prisma.bid.create({
    data: {
      deliveryId: delivery.id,
      riderProfileId: riderId,
      amount: '10.00',
      currency: 'USD',
      status: options?.bidStatus ?? 'OPEN',
    },
  });
  let otherBidId: string | undefined;
  if (options?.competing) {
    const otherRider = await createRider();
    const other = await prisma.bid.create({
      data: {
        deliveryId: delivery.id,
        riderProfileId: otherRider,
        amount: '8.00',
        currency: 'USD',
        status: 'OPEN',
      },
    });
    otherBidId = other.id;
  }
  return { deliveryId: delivery.id, bidId: bid.id, otherBidId, riderId, walletId };
}

async function createRider(): Promise<string> {
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
  return profile.id;
}

function nextPhone(): string {
  phone += 1;
  return `+263${phone}`;
}

function nextRegistration(): string {
  registration += 1;
  return String(registration);
}

const constraintSql = readFileSync(new URL('./bid-acceptance.service.postgres.sql', import.meta.url), 'utf8');

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
