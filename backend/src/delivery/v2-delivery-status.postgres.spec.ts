import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DeliveryStatus, UserRole, WalletEntryType } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RiderAvailabilityService } from '../rider/rider-availability.service.js';
import { BidAcceptanceService } from './bid-acceptance.service.js';
import { BidService } from './bid.service.js';
import { DeliveryService } from './delivery.service.js';
import { DispatchService } from './dispatch.service.js';
import { signedCentsFromDecimal } from '../rider/wallet-money.js';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const PRISMA_CLI = require.resolve('prisma/build/index.js');
const HOST = '127.0.0.1';
const PORT = 54351;
const DATABASE = 'status_m5a';
const CONTAINER = 'riders-m5a-status-pg';
const DISPOSABLE_URL = `postgresql://postgres:postgres@${HOST}:${PORT}/${DATABASE}`;
const NOW = new Date('2026-10-24T08:00:00.000Z');
const DEADLINE = new Date('2026-10-24T18:00:00.000Z');
const V2_STEPS = [
  DeliveryStatus.COLLECTED,
  DeliveryStatus.DELIVERED,
] as const;
const V1_STEPS = [
  DeliveryStatus.ARRIVED_AT_PICKUP,
  DeliveryStatus.PICKED_UP,
  DeliveryStatus.IN_TRANSIT,
  DeliveryStatus.ARRIVED_AT_DROPOFF,
  DeliveryStatus.DELIVERED,
] as const;

let prisma: PrismaService;
let acceptance: BidAcceptanceService;
let dispatch: DispatchService;
let customer: { userId: string; role: typeof UserRole.CUSTOMER; customerAccountId: string };
let adminId = '';
let phone = 790000100;
let registration = 5000;
let progressSequence = 0;
const previousDatabaseUrl = process.env.DATABASE_URL;
const previousFlag = process.env.V2_MARKETPLACE_ENABLED;
const previousSsl = process.env.DATABASE_SSL_CA;

beforeAll(async () => {
  const parsed = new URL(DISPOSABLE_URL);
  if (parsed.hostname !== HOST || parsed.port !== String(PORT) || parsed.pathname !== `/${DATABASE}`) {
    throw new Error('Refusing to use a database that is not the disposable local Phase 5 status database');
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
    await observer.query(`
      CREATE UNIQUE INDEX "delivery_assignments_one_accepted_per_delivery_idx"
        ON "delivery_assignments" ("delivery_id")
        WHERE "status" = 'ACCEPTED'
    `);
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

it('walks the native V2 chain and captures the snapshot only at delivery', async () => {
  await setRate(1_000);
  const hired = await hire();
  const opened = await openJob(hired.riderProfileId, 'FLEXIBLE', '10.00');
  const accepted = await acceptance.accept(customer, opened.deliveryId, opened.bidId, `accept-${opened.deliveryId}`, NOW);
  const before = await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: accepted.assignmentId } });
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: opened.deliveryId } })).status).toBe('RIDER_ASSIGNED');
  expect((await dispatch.activeAssignment(hired.rider, NOW)).assignment?.status).toBe('RIDER_ASSIGNED');

  for (const status of ['ASSIGNED', 'ARRIVED_AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DROPOFF'] as const) {
    await expect(step(hired.rider, opened.deliveryId, status)).rejects.toThrow('This delivery status cannot be changed');
  }
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: opened.deliveryId } })).status).toBe('RIDER_ASSIGNED');

  for (const status of V2_STEPS) {
    const moved = await step(hired.rider, opened.deliveryId, status);
    expect(moved).toMatchObject({ deliveryId: opened.deliveryId, status, availability: 'AVAILABLE' });
    expect((await prisma.delivery.findUniqueOrThrow({ where: { id: opened.deliveryId } })).status).toBe(status);
    expect((await dispatch.liveAssignments(hired.rider, NOW)).assignments.map((row) => row.status))
      .toEqual(status === 'DELIVERED' ? [] : [status]);
    const fees = await feeCount(accepted.assignmentId);
    expect(fees).toBe(status === 'DELIVERED' ? 1 : 0);
  }

  const assignment = await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: accepted.assignmentId } });
  expect(assignment.status).toBe('COMPLETED');
  expect(assignment.idempotencyKey).toBe(before.idempotencyKey);
  expect((await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: accepted.assignmentId } })).status).toBe('CAPTURED');
  const fee = await prisma.riderWalletEntry.findFirstOrThrow({
    where: { idempotencyKey: `platform-fee:assignment:${accepted.assignmentId}` },
  });
  expect(fee.entryType).toBe(WalletEntryType.PLATFORM_FEE);
  expect(signedCentsFromDecimal(fee.amount)).toBe(-100);
  expect(await prisma.v2OutboxEvent.count({ where: { assignmentId: accepted.assignmentId, eventType: 'BID_ACCEPTED' } })).toBe(1);
  for (const eventType of ['COLLECTED', 'DELIVERED'] as const) {
    expect(await prisma.v2OutboxEvent.count({ where: { assignmentId: accepted.assignmentId, eventType } })).toBe(1);
  }
  expect(await prisma.v2OutboxEvent.count({ where: { assignmentId: accepted.assignmentId, eventType: 'COLLECTING' } })).toBe(0);
  expect(await prisma.v2OutboxEvent.count({ where: { assignmentId: accepted.assignmentId, eventType: 'OUT_FOR_DELIVERY' } })).toBe(0);
  expect(await prisma.v2OutboxEvent.count({ where: { assignmentId: accepted.assignmentId } })).toBe(3);
  expect((await prisma.riderProfile.findUniqueOrThrow({ where: { id: hired.riderProfileId } })).receivingRequests).toBe(true);
});

it('refuses to progress a stored legacy assignment', async () => {
  const hired = await hire();
  const offered = await offerV1(hired);
  await recordHistoricalAcceptance(prisma, hired.rider, offered.assignmentId, NOW);
  for (const status of [...V1_STEPS, DeliveryStatus.RIDER_ASSIGNED, DeliveryStatus.COLLECTING, DeliveryStatus.COLLECTED, DeliveryStatus.OUT_FOR_DELIVERY]) {
    await expect(dispatch.progress(hired.rider, offered.deliveryId, { status }, NOW, `stored-${status}`))
      .rejects.toThrow('This delivery status cannot be changed');
  }
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: offered.deliveryId } })).status).toBe('ASSIGNED');
  expect((await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: offered.assignmentId } })).status).toBe('ACCEPTED');
  expect(await prisma.riderWalletEntry.count({ where: { riderWalletId: hired.walletId, entryType: 'PLATFORM_FEE' } })).toBe(0);
  expect(await prisma.deliveryProgressCommand.count({ where: { deliveryId: offered.deliveryId } })).toBe(0);
  expect(await prisma.v2OutboxEvent.count({ where: { deliveryId: offered.deliveryId } })).toBe(0);
  expect((await prisma.riderProfile.findUniqueOrThrow({ where: { id: hired.riderProfileId } })).availability).toBe('BUSY');
});

it('progresses Flexible parcels independently while an Express assignment stays exclusive', async () => {
  await setRate(1_000);
  const hired = await hire();
  const first = await acceptJob(hired, 'FLEXIBLE', '10.00');
  const second = await acceptJob(hired, 'FLEXIBLE', '20.00');
  const express = await acceptJob(hired, 'EXPRESS', '12.00');
  await step(hired.rider, first.deliveryId, 'COLLECTED');
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: second.deliveryId } })).status).toBe('RIDER_ASSIGNED');
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: express.deliveryId } })).status).toBe('RIDER_ASSIGNED');
  await step(hired.rider, second.deliveryId, 'COLLECTED');
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: first.deliveryId } })).status).toBe('COLLECTED');
  await step(hired.rider, express.deliveryId, 'COLLECTED');
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: second.deliveryId } })).status).toBe('COLLECTED');
  const later = await openJob(hired.riderProfileId, 'FLEXIBLE', '8.00');
  await acceptance.accept(customer, later.deliveryId, later.bidId, `blocked-${later.deliveryId}`, NOW);
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: later.deliveryId } })).status).toBe('RIDER_ASSIGNED');
  await step(hired.rider, first.deliveryId, 'DELIVERED');
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: second.deliveryId } })).status).toBe('COLLECTED');
  expect((await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: second.assignmentId } })).status).toBe('ACCEPTED');
  expect((await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: second.assignmentId } })).status).toBe('OPEN');
  expect(await feeCount(first.assignmentId)).toBe(1);
  expect(await feeCount(second.assignmentId)).toBe(0);
  expect(await feeCount(express.assignmentId)).toBe(0);
  expect((await prisma.riderProfile.findUniqueOrThrow({ where: { id: hired.riderProfileId } })).receivingRequests).toBe(true);
});

it('cancels at rider assigned and collecting, and refuses cancellation after collection', async () => {
  await setRate(1_000);
  const hired = await hire();
  const assigned = await acceptJob(hired, 'FLEXIBLE', '10.00');
  const collecting = await acceptJob(hired, 'FLEXIBLE', '10.00');
  const collected = await acceptJob(hired, 'FLEXIBLE', '10.00');
  await prisma.delivery.update({ where: { id: collecting.deliveryId }, data: { status: 'COLLECTING' } });
  await step(hired.rider, collected.deliveryId, 'COLLECTED');

  const riderCancel = await dispatch.cancelBeforePickup(
    hired.rider,
    assigned.assignmentId,
    `cancel-${assigned.assignmentId}`,
    { reason: 'SENDER_UNAVAILABLE' },
    NOW,
  );
  expect(riderCancel).toMatchObject({ status: 'CREATED', reopened: true, released: true });
  expect((await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: assigned.assignmentId } })).status).toBe('RELEASED');

  const duringCollection = await dispatch.cancel(customer, collecting.deliveryId, NOW);
  expect(duringCollection).toEqual({ deliveryId: collecting.deliveryId, status: 'CANCELLED' });
  expect((await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: collecting.assignmentId } })).cancellationStage).toBe('COLLECTING');
  expect((await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: collecting.assignmentId } })).status).toBe('RELEASED');

  await expect(dispatch.cancelBeforePickup(hired.rider, collected.assignmentId, `late-${collected.assignmentId}`, { reason: 'BREAKDOWN' }, NOW))
    .rejects.toThrow('This delivery cannot be cancelled');
  await expect(dispatch.cancel(customer, collected.deliveryId, NOW)).rejects.toThrow('This delivery cannot be cancelled');
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: collected.deliveryId } })).status).toBe('COLLECTED');
  expect((await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: collected.assignmentId } })).status).toBe('OPEN');

  const out = await acceptJob(hired, 'FLEXIBLE', '10.00');
  await step(hired.rider, out.deliveryId, 'COLLECTED');
  await prisma.delivery.update({ where: { id: out.deliveryId }, data: { status: 'OUT_FOR_DELIVERY' } });
  await expect(dispatch.cancelBeforePickup(hired.rider, out.assignmentId, `out-${out.assignmentId}`, { reason: 'BREAKDOWN' }, NOW))
    .rejects.toThrow('This delivery cannot be cancelled');
  await step(hired.rider, out.deliveryId, 'DELIVERED');
  await expect(dispatch.cancel(customer, out.deliveryId, NOW)).rejects.toThrow('This delivery cannot be cancelled');
  expect(await feeCount(out.assignmentId)).toBe(1);
  expect(await feeCount(collected.assignmentId)).toBe(0);
  expect((await prisma.riderProfile.findUniqueOrThrow({ where: { id: hired.riderProfileId } })).receivingRequests).toBe(true);
});

it('finishes committed Flexible deliveries after the marketplace flag is turned off', async () => {
  await setRate(1_000);
  const hired = await hire();
  const first = await acceptJob(hired, 'FLEXIBLE', '10.00');
  const second = await acceptJob(hired, 'FLEXIBLE', '12.00');
    const deliveries = new DeliveryService(prisma);
    const bids = new BidService(prisma);
    const availability = new RiderAvailabilityService(prisma);
  process.env.V2_MARKETPLACE_ENABLED = 'false';
  try {
    const visible = await dispatch.liveAssignments(hired.rider, NOW);
    expect(visible.assignments.map((row) => row.deliveryId).sort()).toEqual([first.deliveryId, second.deliveryId].sort());
    const tracked = await deliveries.getById(customer, first.deliveryId);
    expect(tracked).toMatchObject({ serviceClass: 'FLEXIBLE', status: 'RIDER_ASSIGNED' });
    const listed = await deliveries.list(customer, {});
    expect(listed.data.find((row) => row.id === first.deliveryId)).toMatchObject({ serviceClass: 'FLEXIBLE', status: 'RIDER_ASSIGNED' });
    const stranger = await prisma.user.create({
      data: { fullName: 'Other', phone: nextPhone(), role: UserRole.CUSTOMER, accountStatus: 'ACTIVE', phoneVerifiedAt: NOW },
    });
    const otherAccount = await prisma.customerAccount.create({
      data: { userId: stranger.id, kind: 'INDIVIDUAL', name: 'Other', address: 'Bulawayo' },
    });
    await expect(deliveries.getById(
      { userId: stranger.id, role: UserRole.CUSTOMER, customerAccountId: otherAccount.id },
      first.deliveryId,
    )).rejects.toThrow('Delivery not found');
    await expect(availability.setReceiving(hired.rider, true, NOW)).rejects.toThrow('Bidding is not available');
    const outsider = await hire();
    await expect(step(outsider.rider, first.deliveryId, 'COLLECTED')).rejects.toThrow('Delivery not found');
    expect((await dispatch.liveAssignments(outsider.rider, NOW)).assignments).toEqual([]);
    await step(hired.rider, first.deliveryId, 'COLLECTED');
    expect(await deliveries.getById(customer, first.deliveryId)).toMatchObject({ serviceClass: 'FLEXIBLE', status: 'COLLECTED' });
    expect((await prisma.delivery.findUniqueOrThrow({ where: { id: second.deliveryId } })).status).toBe('RIDER_ASSIGNED');
    const cancelled = await dispatch.cancelBeforePickup(
      hired.rider,
      second.assignmentId,
      `off-${second.assignmentId}`,
      { reason: 'SENDER_UNAVAILABLE' },
      NOW,
    );
    expect(cancelled).toMatchObject({ reopened: true, released: true, status: 'CREATED' });
    expect((await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: second.assignmentId } })).status).toBe('RELEASED');
    await step(hired.rider, first.deliveryId, 'DELIVERED');
    expect(await feeCount(first.assignmentId)).toBe(1);
    const another = await openJob(hired.riderProfileId, 'FLEXIBLE', '9.00');
    await expect(bids.listOpenRequests(NOW)).rejects.toThrow('Bidding is not available');
    await expect(bids.submit(
      hired.rider,
      { deliveryId: another.deliveryId, amountCents: 900 },
      `bid-${another.deliveryId}`,
      NOW,
    )).rejects.toThrow('Bidding is not available');
    await expect(acceptance.accept(customer, another.deliveryId, another.bidId, `accept-${another.deliveryId}`, NOW))
      .rejects.toThrow('Bidding is not available');
    const beforeRequests = await prisma.delivery.count({ where: { serviceClass: { not: null } } });
    await expect(deliveries.create(customer, {
      serviceClass: 'FLEXIBLE',
      deliverBy: DEADLINE.toISOString(),
    })).rejects.toThrow();
    expect(await prisma.delivery.count({ where: { serviceClass: { not: null } } })).toBe(beforeRequests);
    expect(await dispatch.liveAssignments(hired.rider, NOW)).toMatchObject({ assignments: [] });
  } finally {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
  }
});

it('replays a V2 progress key and rejects a different payload', async () => {
  await setRate(1_000);
  const hired = await hire();
  const opened = await acceptJob(hired, 'FLEXIBLE', '10.00');
  const key = `progress-${opened.deliveryId}`;
  await expect(dispatch.progress(hired.rider, opened.deliveryId, { status: 'COLLECTED' }, NOW))
    .rejects.toThrow('Enter an idempotency key');
  await expect(dispatch.progress(hired.rider, opened.deliveryId, { status: 'COLLECTING' }, NOW, `rejected-${opened.deliveryId}`))
    .rejects.toThrow('This delivery status cannot be changed');
  const first = await dispatch.progress(hired.rider, opened.deliveryId, { status: 'COLLECTED' }, NOW, key);
  const replay = await dispatch.progress(hired.rider, opened.deliveryId, { status: 'COLLECTED' }, NOW, key);
  expect(replay).toEqual(first);
  expect(await prisma.deliveryStatusEvent.count({ where: { deliveryId: opened.deliveryId, newStatus: 'COLLECTED' } })).toBe(1);
  expect(await prisma.deliveryProgressCommand.count({ where: { assignmentId: opened.assignmentId } })).toBe(1);
  expect(await prisma.v2OutboxEvent.count({ where: { assignmentId: opened.assignmentId, eventType: 'COLLECTED' } })).toBe(1);
  expect((await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: opened.assignmentId } })).idempotencyKey)
    .toBe(opened.acceptKey);
  await expect(dispatch.progress(hired.rider, opened.deliveryId, { status: 'DELIVERED' }, NOW, key))
    .rejects.toThrow('This idempotency key was already used');
  await expect(dispatch.progress(hired.rider, opened.deliveryId, { status: 'OUT_FOR_DELIVERY' }, NOW, `start-${opened.deliveryId}`))
    .rejects.toThrow('This delivery status cannot be changed');
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: opened.deliveryId } })).status).toBe('COLLECTED');
  expect(await feeCount(opened.assignmentId)).toBe(0);
});

it('lets one of two concurrent status commands commit and does not skip a step', async () => {
  await setRate(1_000);
  const same = await acceptJob(await hire(), 'FLEXIBLE', '10.00');
  const sameResults = await Promise.all([
    dispatch.progress(same.rider, same.deliveryId, { status: 'COLLECTED' }, NOW, `same-${same.deliveryId}`),
    dispatch.progress(same.rider, same.deliveryId, { status: 'COLLECTED' }, NOW, `same-${same.deliveryId}`),
  ]);
  expect(sameResults.every((result) => result.status === 'COLLECTED')).toBe(true);
  expect(await prisma.deliveryStatusEvent.count({ where: { deliveryId: same.deliveryId, newStatus: 'COLLECTED' } })).toBe(1);
  expect(await prisma.deliveryProgressCommand.count({ where: { idempotencyKey: `same-${same.deliveryId}` } })).toBe(1);
  expect(await prisma.v2OutboxEvent.count({ where: { deliveryId: same.deliveryId, eventType: 'COLLECTED' } })).toBe(1);

  const raced = await acceptJob(await hire(), 'FLEXIBLE', '10.00');
  const racedResults = await Promise.allSettled([
    dispatch.progress(raced.rider, raced.deliveryId, { status: 'COLLECTED' }, NOW, `one-${raced.deliveryId}`),
    dispatch.progress(raced.rider, raced.deliveryId, { status: 'COLLECTED' }, NOW, `two-${raced.deliveryId}`),
  ]);
  expect(racedResults.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(racedResults.filter((result) => result.status === 'rejected')).toHaveLength(1);
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: raced.deliveryId } })).status).toBe('COLLECTED');

  const skipped = await acceptJob(await hire(), 'FLEXIBLE', '10.00');
  const skippedResults = await Promise.allSettled([
    dispatch.progress(skipped.rider, skipped.deliveryId, { status: 'COLLECTING' }, NOW, `keep-${skipped.deliveryId}`),
    dispatch.progress(skipped.rider, skipped.deliveryId, { status: 'COLLECTED' }, NOW, `skip-${skipped.deliveryId}`),
  ]);
  expect(skippedResults[0]?.status).toBe('rejected');
  expect(skippedResults[1]?.status).toBe('fulfilled');
  const riderEvents = await prisma.deliveryStatusEvent.findMany({
    where: { deliveryId: skipped.deliveryId, actorType: 'RIDER' },
  });
  expect(riderEvents.map((event) => event.newStatus)).toEqual(['COLLECTED']);
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: skipped.deliveryId } })).status).toBe('COLLECTED');
  expect((await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: skipped.assignmentId } })).status).toBe('ACCEPTED');
  expect(await feeCount(skipped.assignmentId)).toBe(0);
});

it('captures a 0% snapshot once at delivery and posts no ledger row', async () => {
  await setRate(0);
  const hired = await hire();
  const opened = await acceptJob(hired, 'FLEXIBLE', '10.00');
  expect(await prisma.walletFeeReservation.count({ where: { assignmentId: opened.assignmentId } })).toBe(0);
  for (const status of V2_STEPS) {
    await step(hired.rider, opened.deliveryId, status);
    expect(await feeCount(opened.assignmentId)).toBe(0);
  }
  expect((await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: opened.assignmentId } })).status).toBe('COMPLETED');
  expect(await prisma.riderWalletEntry.count({ where: { riderWalletId: hired.walletId } })).toBe(0);
  await setRate(1_000);
});

async function step(
  rider: { userId: string; riderProfileId: string },
  deliveryId: string,
  status: DeliveryStatus,
) {
  progressSequence += 1;
  return dispatch.progress(rider, deliveryId, { status }, NOW, `step-${deliveryId}-${status}-${progressSequence}`);
}

async function feeCount(assignmentId: string) {
  return prisma.riderWalletEntry.count({ where: { idempotencyKey: `platform-fee:assignment:${assignmentId}` } });
}

async function acceptJob(hired: Hired, serviceClass: 'FLEXIBLE' | 'EXPRESS', amount: string) {
  const opened = await openJob(hired.riderProfileId, serviceClass, amount);
  const accepted = await acceptance.accept(customer, opened.deliveryId, opened.bidId, `accept-${opened.deliveryId}`, NOW);
  return {
    rider: hired.rider,
    deliveryId: opened.deliveryId,
    assignmentId: accepted.assignmentId,
    acceptKey: `accept-${opened.deliveryId}`,
  };
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
  walletId: string;
};

async function hire(): Promise<Hired> {
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
  const wallet = await prisma.riderWallet.create({
    data: { riderProfileId: profile.id, currency: 'USD', balance: '0.00', borrowingLimitOverride: '50.00' },
  });
  return { rider: { userId: user.id, riderProfileId: profile.id }, riderProfileId: profile.id, walletId: wallet.id };
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
