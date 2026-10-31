import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DeliveryStatus, UserRole } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RiderAvailabilityService } from '../rider/rider-availability.service.js';
import { BidAcceptanceService } from './bid-acceptance.service.js';
import { BidService } from './bid.service.js';
import { DispatchService } from './dispatch.service.js';
import { centsFromDecimal } from './money.js';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const PRISMA_CLI = require.resolve('prisma/build/index.js');
const HOST = '127.0.0.1';
const PORT = 54350;
const DATABASE = 'express_m4b';
const CONTAINER = 'riders-m4b-express-pg';
const DISPOSABLE_URL = `postgresql://postgres:postgres@${HOST}:${PORT}/${DATABASE}`;
const NOW = new Date('2026-10-24T08:00:00.000Z');
const DEADLINE = new Date('2026-10-24T18:00:00.000Z');
const PROGRESS = [
  DeliveryStatus.COLLECTED,
  DeliveryStatus.DELIVERED,
] as const;

let prisma: PrismaService;
let acceptance: BidAcceptanceService;
let bids: BidService;
let dispatch: DispatchService;
let availability: RiderAvailabilityService;
let customer: { userId: string; role: typeof UserRole.CUSTOMER; customerAccountId: string };
let adminId = '';
let phone = 780000100;
let registration = 4000;
const previousDatabaseUrl = process.env.DATABASE_URL;
const previousFlag = process.env.V2_MARKETPLACE_ENABLED;
const previousSsl = process.env.DATABASE_SSL_CA;

beforeAll(async () => {
  const parsed = new URL(DISPOSABLE_URL);
  if (parsed.hostname !== HOST || parsed.port !== String(PORT) || parsed.pathname !== `/${DATABASE}`) {
    throw new Error('Refusing to use a database that is not the disposable local Phase 4 database');
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
    for (const statement of sqlStatements(readFileSync(new URL('./commission-capture.postgres.sql', import.meta.url), 'utf8'))) {
      await observer.query(statement);
    }
    for (const statement of sqlStatements(readFileSync(new URL('../../prisma/migrations/20261024160000_v2_flexible_express/migration.sql', import.meta.url), 'utf8'))) {
      await observer.query(statement);
    }
    for (const statement of sqlStatements(readFileSync(new URL('../../prisma/migrations/20261026190000_rider_multiple_assignments/migration.sql', import.meta.url), 'utf8'))) {
      await observer.query(statement);
    }
    await observer.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "delivery_assignments_one_accepted_per_delivery_idx"
        ON "delivery_assignments" ("delivery_id")
        WHERE "status" = 'ACCEPTED'
    `);
    await observer.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "delivery_assignments_one_open_offer_per_rider_idx"
        ON "delivery_assignments" ("delivery_id", "rider_profile_id")
        WHERE "status" IN ('OFFERED', 'ACCEPTED')
    `);
    await observer.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "bids_one_accepted_per_delivery_idx"
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
  availability = new RiderAvailabilityService(prisma);
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
  await prisma.commissionPolicy.create({
    data: { policyVersion: 1, model: 'ON_COMPLETION', isActive: true, createdById: adminId },
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

it('allows many accepted assignments per rider and one accepted assignment per delivery', async () => {
  const rows = await prisma.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname FROM pg_indexes WHERE tablename = 'delivery_assignments'
  `;
  const names = rows.map((row) => row.indexname);
  expect(names).not.toContain('delivery_assignments_one_accepted_per_rider_idx');
  expect(names).not.toContain('delivery_assignments_one_live_express_per_rider_idx');
  expect(names).not.toContain('delivery_assignments_one_accepted_v1_per_rider_idx');
  expect(names).toContain('delivery_assignments_one_accepted_per_delivery_idx');
  expect(names).toContain('delivery_assignments_one_open_offer_per_rider_idx');
});

it('accepts several Flexible deliveries awaiting pickup and keeps separate reservations', async () => {
  await setRate(1_000);
  const hired = await hire();
  const first = await openJob(hired.riderProfileId, 'FLEXIBLE', '10.00');
  const second = await openJob(hired.riderProfileId, 'FLEXIBLE', '20.00');
  const acceptedFirst = await acceptance.accept(customer, first.deliveryId, first.bidId, `flex-a-${first.deliveryId}`, NOW);
  const acceptedSecond = await acceptance.accept(customer, second.deliveryId, second.bidId, `flex-b-${second.deliveryId}`, new Date(NOW.getTime() + 1_000));
  expect(acceptedFirst.availability).toBe('AVAILABLE');
  expect(acceptedSecond.availability).toBe('AVAILABLE');
  const assignments = await prisma.deliveryAssignment.findMany({
    where: { riderProfileId: hired.riderProfileId, status: 'ACCEPTED' },
    orderBy: { createdAt: 'asc' },
  });
  expect(assignments).toHaveLength(2);
  expect(assignments.every((row) => row.serviceClass === 'FLEXIBLE')).toBe(true);
  expect(centsFromDecimal(assignments[0]!.acceptedCommissionAmount!)).toBe(100);
  expect(centsFromDecimal(assignments[1]!.acceptedCommissionAmount!)).toBe(200);
  const deliveries = await prisma.delivery.findMany({
    where: { id: { in: [first.deliveryId, second.deliveryId] } },
  });
  expect(deliveries.every((row) => row.status === 'RIDER_ASSIGNED')).toBe(true);
  const reservations = await prisma.walletFeeReservation.findMany({
    where: { riderWalletId: hired.walletId, status: 'OPEN' },
  });
  expect(reservations).toHaveLength(2);
  expect(reservations.reduce((sum, row) => sum + centsFromDecimal(row.amount), 0)).toBe(300);
  const rider = await prisma.riderProfile.findUniqueOrThrow({ where: { id: hired.riderProfileId } });
  expect(rider.availability).toBe('AVAILABLE');
  expect(rider.receivingRequests).toBe(true);
  const listed = await dispatch.liveAssignments(hired.rider);
  expect(listed.assignments.map((row) => row.assignmentId)).toEqual(assignments.map((row) => row.id));
  const active = await dispatch.activeAssignment(hired.rider);
  expect(active.assignment?.assignmentId).toBeTruthy();
  expect(Array.isArray(active.assignment)).toBe(false);
});

it('accepts Express beside Flexible work and keeps later bids open to the same rider', async () => {
  await setRate(1_000);
  const hired = await hire();
  const flexible = await openJob(hired.riderProfileId, 'FLEXIBLE', '10.00');
  const express = await openJob(hired.riderProfileId, 'EXPRESS', '30.00');
  const laterFlexible = await openJob(hired.riderProfileId, 'FLEXIBLE', '12.00');
  const laterExpress = await openJob(hired.riderProfileId, 'EXPRESS', '14.00');
  await acceptance.accept(customer, flexible.deliveryId, flexible.bidId, `keep-${flexible.deliveryId}`, NOW);
  const beforeReservation = await prisma.walletFeeReservation.findFirstOrThrow({ where: { deliveryId: flexible.deliveryId } });
  await acceptance.accept(customer, express.deliveryId, express.bidId, `express-${express.deliveryId}`, NOW);
  const after = await prisma.deliveryAssignment.findFirstOrThrow({ where: { deliveryId: flexible.deliveryId } });
  const afterReservation = await prisma.walletFeeReservation.findFirstOrThrow({ where: { deliveryId: flexible.deliveryId } });
  expect(after.status).toBe('ACCEPTED');
  expect(after.serviceClass).toBe('FLEXIBLE');
  expect(afterReservation.status).toBe('OPEN');
  expect(afterReservation.amount.toFixed(2)).toBe(beforeReservation.amount.toFixed(2));
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: flexible.deliveryId } })).deliverBy?.toISOString()).toBe(DEADLINE.toISOString());
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: flexible.deliveryId } })).status).toBe('RIDER_ASSIGNED');
  await acceptance.accept(customer, laterFlexible.deliveryId, laterFlexible.bidId, `later-flex-${laterFlexible.deliveryId}`, NOW);
  await acceptance.accept(customer, laterExpress.deliveryId, laterExpress.bidId, `later-express-${laterExpress.deliveryId}`, NOW);
  expect(await prisma.deliveryAssignment.count({ where: { riderProfileId: hired.riderProfileId, status: 'ACCEPTED', serviceClass: 'EXPRESS' } })).toBe(2);
  expect((await prisma.bid.findUniqueOrThrow({ where: { id: laterFlexible.bidId } })).status).toBe('ACCEPTED');
});

it('lets two concurrent Express acceptances both assign the same rider', async () => {
  await setRate(1_000);
  const hired = await hire();
  const first = await openJob(hired.riderProfileId, 'EXPRESS', '10.00');
  const second = await openJob(hired.riderProfileId, 'EXPRESS', '11.00');
  const results = await Promise.allSettled([
    acceptance.accept(customer, first.deliveryId, first.bidId, `race-express-a-${first.deliveryId}`, NOW),
    acceptance.accept(customer, second.deliveryId, second.bidId, `race-express-b-${second.deliveryId}`, NOW),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
  expect(await prisma.deliveryAssignment.count({ where: { riderProfileId: hired.riderProfileId, status: 'ACCEPTED', serviceClass: 'EXPRESS' } })).toBe(2);
  const extra = await openJob(hired.riderProfileId, 'EXPRESS', '10.00');
  await prisma.deliveryAssignment.create({
    data: {
      deliveryId: extra.deliveryId,
      riderProfileId: hired.riderProfileId,
      motorcycleId: hired.motorcycleId,
      status: 'ACCEPTED',
      offerExpiresAt: DEADLINE,
      serviceClass: 'EXPRESS',
      acceptedBidAmount: '10.00',
      acceptedCommissionBasisPoints: 1_000,
      acceptedV2CommissionRateVersion: 1,
      acceptedCommissionAmount: '1.00',
      createdAt: NOW,
    },
  });
  expect(await prisma.deliveryAssignment.count({ where: { riderProfileId: hired.riderProfileId, status: 'ACCEPTED', serviceClass: 'EXPRESS' } })).toBe(3);
});

it('follows both Express and Flexible commit orders', async () => {
  await setRate(1_000);
  const flexibleFirst = await hire();
  const parked = await openJob(flexibleFirst.riderProfileId, 'FLEXIBLE', '10.00');
  const urgent = await openJob(flexibleFirst.riderProfileId, 'EXPRESS', '10.00');
  await acceptance.accept(customer, parked.deliveryId, parked.bidId, `order-flex-${parked.deliveryId}`, NOW);
  await acceptance.accept(customer, urgent.deliveryId, urgent.bidId, `order-express-${urgent.deliveryId}`, NOW);
  expect(await prisma.deliveryAssignment.count({ where: { riderProfileId: flexibleFirst.riderProfileId, status: 'ACCEPTED' } })).toBe(2);

  const expressFirst = await hire();
  const urgentFirst = await openJob(expressFirst.riderProfileId, 'EXPRESS', '10.00');
  const parkedLater = await openJob(expressFirst.riderProfileId, 'FLEXIBLE', '10.00');
  await acceptance.accept(customer, urgentFirst.deliveryId, urgentFirst.bidId, `order-express-first-${urgentFirst.deliveryId}`, NOW);
  await acceptance.accept(customer, parkedLater.deliveryId, parkedLater.bidId, `order-flex-second-${parkedLater.deliveryId}`, NOW);
  expect(await prisma.deliveryAssignment.count({ where: { riderProfileId: expressFirst.riderProfileId, status: 'ACCEPTED', serviceClass: 'FLEXIBLE' } })).toBe(1);

  const racing = await hire();
  const raceFlexible = await openJob(racing.riderProfileId, 'FLEXIBLE', '10.00');
  const raceExpress = await openJob(racing.riderProfileId, 'EXPRESS', '10.00');
  await Promise.allSettled([
    acceptance.accept(customer, raceFlexible.deliveryId, raceFlexible.bidId, `race-flex-${raceFlexible.deliveryId}`, NOW),
    acceptance.accept(customer, raceExpress.deliveryId, raceExpress.bidId, `race-express-${raceExpress.deliveryId}`, NOW),
  ]);
  expect(await prisma.deliveryAssignment.count({ where: { riderProfileId: racing.riderProfileId, status: 'ACCEPTED', serviceClass: 'EXPRESS' } })).toBe(1);
  expect(await prisma.deliveryAssignment.count({ where: { riderProfileId: racing.riderProfileId, status: 'ACCEPTED', serviceClass: 'FLEXIBLE' } })).toBe(1);
});

it('lets one rider hold a V1 assignment and a V2 assignment together', async () => {
  await setRate(1_000);
  const v2First = await hire();
  const flexible = await openJob(v2First.riderProfileId, 'FLEXIBLE', '10.00');
  await acceptance.accept(customer, flexible.deliveryId, flexible.bidId, `v2-first-${flexible.deliveryId}`, NOW);
  const offer = await offerV1(v2First);
  await recordHistoricalAcceptance(prisma, v2First.rider, offer.assignmentId, NOW);
  expect(await prisma.deliveryAssignment.count({ where: { riderProfileId: v2First.riderProfileId, status: 'ACCEPTED' } })).toBe(2);

  const v1First = await hire();
  const legacy = await offerV1(v1First);
  await recordHistoricalAcceptance(prisma, v1First.rider, legacy.assignmentId, NOW);
  const blocked = await openJob(v1First.riderProfileId, 'FLEXIBLE', '10.00');
  await acceptance.accept(customer, blocked.deliveryId, blocked.bidId, `v2-after-${blocked.deliveryId}`, NOW);
  expect(await prisma.deliveryAssignment.count({ where: { riderProfileId: v1First.riderProfileId, status: 'ACCEPTED' } })).toBe(2);
  expect((await prisma.riderProfile.findUniqueOrThrow({ where: { id: v1First.riderProfileId } })).availability).toBe('BUSY');
  expect((await prisma.riderProfile.findUniqueOrThrow({ where: { id: v1First.riderProfileId } })).receivingRequests).toBe(true);
});

it('captures one Flexible delivery and leaves the other assignment and reservation active', async () => {
  await setRate(1_000);
  const hired = await hire();
  const first = await openJob(hired.riderProfileId, 'FLEXIBLE', '10.00');
  const second = await openJob(hired.riderProfileId, 'FLEXIBLE', '20.00');
  const accepted = await acceptance.accept(customer, first.deliveryId, first.bidId, `done-${first.deliveryId}`, NOW);
  await acceptance.accept(customer, second.deliveryId, second.bidId, `stay-${second.deliveryId}`, NOW);
  await deliver(hired.rider, first.deliveryId);
  expect((await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: accepted.assignmentId } })).status).toBe('COMPLETED');
  expect((await prisma.deliveryAssignment.findFirstOrThrow({ where: { deliveryId: second.deliveryId } })).status).toBe('ACCEPTED');
  expect((await prisma.walletFeeReservation.findFirstOrThrow({ where: { deliveryId: first.deliveryId } })).status).toBe('CAPTURED');
  expect((await prisma.walletFeeReservation.findFirstOrThrow({ where: { deliveryId: second.deliveryId } })).status).toBe('OPEN');
  expect(await prisma.riderWalletEntry.count({ where: { idempotencyKey: `platform-fee:assignment:${accepted.assignmentId}` } })).toBe(1);
  expect((await prisma.riderProfile.findUniqueOrThrow({ where: { id: hired.riderProfileId } })).availability).toBe('AVAILABLE');
  expect((await prisma.riderProfile.findUniqueOrThrow({ where: { id: hired.riderProfileId } })).receivingRequests).toBe(true);
});

it('releases only the cancelled Flexible reservation', async () => {
  await setRate(1_000);
  const hired = await hire();
  const first = await openJob(hired.riderProfileId, 'FLEXIBLE', '10.00');
  const second = await openJob(hired.riderProfileId, 'FLEXIBLE', '20.00');
  const cancelled = await acceptance.accept(customer, first.deliveryId, first.bidId, `cancel-${first.deliveryId}`, NOW);
  await acceptance.accept(customer, second.deliveryId, second.bidId, `keep-${second.deliveryId}`, NOW);
  await dispatch.cancelBeforePickup(hired.rider, cancelled.assignmentId, `cancel-key-${cancelled.assignmentId}`, { reason: 'PAYMENT_NOT_AGREED' }, NOW);
  expect((await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: cancelled.assignmentId } })).status).toBe('RELEASED');
  expect((await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: cancelled.assignmentId } })).status).toBe('RELEASED');
  expect((await prisma.deliveryAssignment.findFirstOrThrow({ where: { deliveryId: second.deliveryId } })).status).toBe('ACCEPTED');
  expect((await prisma.walletFeeReservation.findFirstOrThrow({ where: { deliveryId: second.deliveryId } })).status).toBe('OPEN');
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: second.deliveryId } })).status).toBe('RIDER_ASSIGNED');
  expect(await prisma.riderWalletEntry.count({ where: { idempotencyKey: `platform-fee:assignment:${cancelled.assignmentId}` } })).toBe(0);
});

it('allows a new Flexible acceptance after Express ends while earlier Flexible work remains', async () => {
  await setRate(1_000);
  const hired = await hire();
  const flexible = await openJob(hired.riderProfileId, 'FLEXIBLE', '10.00');
  const express = await openJob(hired.riderProfileId, 'EXPRESS', '10.00');
  const next = await openJob(hired.riderProfileId, 'FLEXIBLE', '16.00');
  await acceptance.accept(customer, flexible.deliveryId, flexible.bidId, `remain-${flexible.deliveryId}`, NOW);
  const acceptedExpress = await acceptance.accept(customer, express.deliveryId, express.bidId, `end-${express.deliveryId}`, NOW);
  await deliver(hired.rider, express.deliveryId);
  await acceptance.accept(customer, next.deliveryId, next.bidId, `again-${next.deliveryId}`, NOW);
  expect((await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: acceptedExpress.assignmentId } })).status).toBe('COMPLETED');
  expect(await prisma.deliveryAssignment.count({ where: { riderProfileId: hired.riderProfileId, status: 'ACCEPTED', serviceClass: 'FLEXIBLE' } })).toBe(2);
  expect((await prisma.riderProfile.findUniqueOrThrow({ where: { id: hired.riderProfileId } })).receivingRequests).toBe(true);
});

it('stops new commitments when the rider goes offline and leaves completed work in place', async () => {
  await setRate(1_000);
  const hired = await hire();
  const first = await openJob(hired.riderProfileId, 'FLEXIBLE', '10.00');
  const second = await openJob(hired.riderProfileId, 'FLEXIBLE', '12.00');
  const third = await openJob(hired.riderProfileId, 'FLEXIBLE', '14.00');
  const accepted = await acceptance.accept(customer, first.deliveryId, first.bidId, `pause-base-${first.deliveryId}`, NOW);
  expect((await prisma.riderProfile.findUniqueOrThrow({ where: { id: hired.riderProfileId } })).receivingRequests).toBe(true);
  await availability.offline(hired.rider, NOW);
  await expect(acceptance.accept(customer, second.deliveryId, second.bidId, `pause-block-${second.deliveryId}`, NOW))
    .rejects.toThrow('This rider is not available');
  await deliver(hired.rider, first.deliveryId);
  expect((await prisma.riderProfile.findUniqueOrThrow({ where: { id: hired.riderProfileId } })).receivingRequests).toBe(false);
  expect((await prisma.riderProfile.findUniqueOrThrow({ where: { id: hired.riderProfileId } })).availability).toBe('OFFLINE');
  await availability.online(hired.rider, NOW);
  const kept = await acceptance.accept(customer, second.deliveryId, second.bidId, `pause-next-${second.deliveryId}`, NOW);
  await availability.offline(hired.rider, NOW);
  await dispatch.cancelBeforePickup(hired.rider, kept.assignmentId, `pause-cancel-${kept.assignmentId}`, { reason: 'PAYMENT_NOT_AGREED' }, NOW);
  expect((await prisma.riderProfile.findUniqueOrThrow({ where: { id: hired.riderProfileId } })).receivingRequests).toBe(false);
  expect((await prisma.riderProfile.findUniqueOrThrow({ where: { id: hired.riderProfileId } })).availability).toBe('OFFLINE');
  await expect(acceptance.accept(customer, third.deliveryId, third.bidId, `pause-still-${third.deliveryId}`, NOW))
    .rejects.toThrow('This rider is not available');
  expect((await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: accepted.assignmentId } })).status).toBe('COMPLETED');
});

it('refuses a new V2 commitment while offline and keeps the accepted assignment', async () => {
  await setRate(1_000);
  const hired = await hire();
  const current = await openJob(hired.riderProfileId, 'FLEXIBLE', '10.00');
  const next = await openJob(hired.riderProfileId, 'FLEXIBLE', '11.00');
  const accepted = await acceptance.accept(customer, current.deliveryId, current.bidId, `offline-keep-${current.deliveryId}`, NOW);
  await availability.offline(hired.rider, NOW);
  await expect(acceptance.accept(customer, next.deliveryId, next.bidId, `offline-block-${next.deliveryId}`, NOW))
    .rejects.toThrow('This rider is not available');
  expect((await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: accepted.assignmentId } })).status).toBe('ACCEPTED');
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: current.deliveryId } })).status).toBe('RIDER_ASSIGNED');
  expect((await prisma.riderProfile.findUniqueOrThrow({ where: { id: hired.riderProfileId } })).availability).toBe('OFFLINE');
  expect((await prisma.riderProfile.findUniqueOrThrow({ where: { id: hired.riderProfileId } })).receivingRequests).toBe(false);
});

it('counts every open reservation toward wallet capacity and allows a zero-percent assignment beside a paid one', async () => {
  await setRate(1_000);
  const tight = await hire('1.00');
  const first = await openJob(tight.riderProfileId, 'FLEXIBLE', '10.00');
  const second = await openJob(tight.riderProfileId, 'FLEXIBLE', '10.00');
  const results = await Promise.allSettled([
    acceptance.accept(customer, first.deliveryId, first.bidId, `cap-a-${first.deliveryId}`, NOW),
    acceptance.accept(customer, second.deliveryId, second.bidId, `cap-b-${second.deliveryId}`, NOW),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((result) => result.status === 'rejected');
  expect(rejected?.status === 'rejected' ? String(rejected.reason) : '').toContain('Wallet capacity is not enough for this bid');
  const open = await prisma.walletFeeReservation.findMany({ where: { riderWalletId: tight.walletId, status: 'OPEN' } });
  expect(open).toHaveLength(1);
  expect(open.reduce((sum, row) => sum + centsFromDecimal(row.amount), 0)).toBeLessThanOrEqual(100);

  const mixed = await hire();
  const paid = await openJob(mixed.riderProfileId, 'FLEXIBLE', '10.00');
  await acceptance.accept(customer, paid.deliveryId, paid.bidId, `paid-${paid.deliveryId}`, NOW);
  await setRate(0);
  const free = await openJob(mixed.riderProfileId, 'FLEXIBLE', '25.00');
  const zero = await acceptance.accept(customer, free.deliveryId, free.bidId, `zero-${free.deliveryId}`, NOW);
  expect(zero).toMatchObject({ commissionAmount: '0.00', reserved: false });
  expect(await prisma.walletFeeReservation.count({ where: { deliveryId: free.deliveryId } })).toBe(0);
  expect((await prisma.walletFeeReservation.findFirstOrThrow({ where: { deliveryId: paid.deliveryId } })).status).toBe('OPEN');
  expect(await prisma.riderWalletEntry.count({ where: { riderWalletId: mixed.walletId } })).toBe(0);
  await setRate(1_000);
});

it('lists and accepts an open Flexible bid while Express is live, then replays the original acceptance', async () => {
  await setRate(1_000);
  const hired = await hire();
  const fresh = await prisma.delivery.create({ data: deliveryData('FLEXIBLE') });
  const hiddenDelivery = await prisma.delivery.create({ data: deliveryData('FLEXIBLE') });
  const hidden = await prisma.bid.create({
    data: { deliveryId: hiddenDelivery.id, riderProfileId: hired.riderProfileId, amount: '9.00', currency: 'USD', status: 'OPEN' },
  });
  const express = await openJob(hired.riderProfileId, 'EXPRESS', '10.00');
  const accepted = await acceptance.accept(customer, express.deliveryId, express.bidId, `hide-${express.deliveryId}`, NOW);
  const replay = await acceptance.accept(customer, express.deliveryId, express.bidId, `hide-${express.deliveryId}`, NOW);
  expect(replay).toMatchObject({ assignmentId: accepted.assignmentId, replayed: true });
  expect((await bids.listForCustomer(customer, hiddenDelivery.id, NOW)).map((bid) => bid.id)).toEqual([hidden.id]);
  expect((await prisma.bid.findUniqueOrThrow({ where: { id: hidden.id } })).status).toBe('OPEN');
  const submitted = await bids.submit(hired.rider, { deliveryId: fresh.id, amountCents: 1_100, currency: 'USD' }, `new-bid-${fresh.id}`, NOW);
  expect(submitted.deliveryId).toBe(fresh.id);
  await acceptance.accept(customer, hiddenDelivery.id, hidden.id, `hidden-${hidden.id}`, NOW);
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: hiddenDelivery.id } })).status).toBe('RIDER_ASSIGNED');
});

it('does not include another rider in the live assignment list', async () => {
  await setRate(1_000);
  const first = await hire();
  const second = await hire();
  const own = await openJob(first.riderProfileId, 'FLEXIBLE', '10.00');
  const theirs = await openJob(second.riderProfileId, 'FLEXIBLE', '10.00');
  const accepted = await acceptance.accept(customer, own.deliveryId, own.bidId, `own-${own.deliveryId}`, NOW);
  await acceptance.accept(customer, theirs.deliveryId, theirs.bidId, `theirs-${theirs.deliveryId}`, NOW);
  const listed = await dispatch.liveAssignments(first.rider);
  expect(listed.assignments.map((row) => row.deliveryId)).toEqual([own.deliveryId]);
  expect(listed.assignments.map((row) => row.assignmentId)).toEqual([accepted.assignmentId]);
});

async function deliver(rider: { userId: string; riderProfileId: string }, deliveryId: string) {
  for (const status of PROGRESS) {
    await dispatch.progress(rider, deliveryId, { status }, NOW, `deliver-${deliveryId}-${status}`);
  }
}

async function recordHistoricalAcceptance(
  db: PrismaService,
  rider: { riderProfileId: string },
  assignmentId: string,
  now: Date,
) {
  const motorcycle = await db.motorcycle.findFirst({
    where: { riderProfileId: rider.riderProfileId, isActive: true },
  });
  const assignment = await db.deliveryAssignment.update({
    where: { id: assignmentId },
    data: {
      status: 'ACCEPTED',
      motorcycleId: motorcycle?.id ?? null,
      respondedAt: now,
      acceptedPlatformFee: '0.30',
      acceptedFeeConfigVersion: 1,
      acceptedCommissionModel: 'ON_COMPLETION',
      acceptedCommissionPolicyVersion: 1,
    },
  });
  await db.delivery.update({
    where: { id: assignment.deliveryId },
    data: { status: 'ASSIGNED', updatedAt: now },
  });
  await db.riderProfile.update({
    where: { id: rider.riderProfileId },
    data: { availability: 'BUSY', updatedAt: now },
  });
}

async function offerV1(hired: Hired) {
  await prisma.riderLocation.create({
    data: {
      riderProfileId: hired.riderProfileId,
      latitude: '-17.8292000',
      longitude: '31.0522000',
      updatedAt: NOW,
    },
  });
  const delivery = await prisma.delivery.create({
    data: {
      ...deliveryData('FLEXIBLE'),
      serviceClass: null,
      deliverBy: null,
      status: 'SEARCHING',
      searchGeneration: 1,
      price: '6.00',
      payer: 'SENDER',
      paymentMethod: 'CASH',
    },
  });
  const assignment = await prisma.deliveryAssignment.create({
    data: {
      deliveryId: delivery.id,
      riderProfileId: hired.riderProfileId,
      status: 'OFFERED',
      offerExpiresAt: new Date(NOW.getTime() + 60_000),
      searchGeneration: 1,
    },
  });
  return { deliveryId: delivery.id, assignmentId: assignment.id };
}

async function openJob(riderProfileId: string, serviceClass: 'FLEXIBLE' | 'EXPRESS', amount: string) {
  const delivery = await prisma.delivery.create({ data: deliveryData(serviceClass) });
  const bid = await prisma.bid.create({
    data: { deliveryId: delivery.id, riderProfileId, amount, currency: 'USD', status: 'OPEN' },
  });
  return { deliveryId: delivery.id, bidId: bid.id };
}

function deliveryData(serviceClass: 'FLEXIBLE' | 'EXPRESS') {
  return {
    customerId: customer.customerAccountId,
    pickupAddress: 'Pickup road',
    pickupCoordinateSource: 'UNREVIEWED' as const,
    pickupContactName: 'Sender',
    pickupContactPhone: '+263770000001',
    dropoffAddress: 'Dropoff road',
    dropoffCoordinateSource: 'UNREVIEWED' as const,
    parcelDescription: 'Documents',
    parcelSize: 'SMALL' as const,
    recipientName: 'Recipient',
    recipientPhone: '+263770000002',
    suggestedPrice: '9.00',
    distanceMeters: 1_000,
    pricingVersion: 1,
    currency: 'USD' as const,
    serviceClass,
    deliverBy: DEADLINE,
    status: 'CREATED' as const,
    searchGeneration: 0,
  };
}

type Hired = {
  rider: { userId: string; riderProfileId: string };
  riderProfileId: string;
  motorcycleId: string;
  walletId: string;
};

async function hire(borrowingLimit = '50.00'): Promise<Hired> {
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
  const wallet = await prisma.riderWallet.create({
    data: { riderProfileId: profile.id, currency: 'USD', balance: '0.00', borrowingLimitOverride: borrowingLimit },
  });
  return {
    rider: { userId: user.id, riderProfileId: profile.id },
    riderProfileId: profile.id,
    motorcycleId: motorcycle.id,
    walletId: wallet.id,
  };
}

async function setRate(basisPoints: number) {
  const active = await prisma.v2CommissionRate.findFirst({ where: { isActive: true } });
  if (active?.basisPoints === basisPoints) return active;
  const highest = await prisma.v2CommissionRate.findFirst({ orderBy: { rateVersion: 'desc' } });
  if (active) await prisma.v2CommissionRate.update({ where: { id: active.id }, data: { isActive: false } });
  return prisma.v2CommissionRate.create({
    data: { rateVersion: (highest?.rateVersion ?? 0) + 1, basisPoints, isActive: true, createdById: adminId },
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
