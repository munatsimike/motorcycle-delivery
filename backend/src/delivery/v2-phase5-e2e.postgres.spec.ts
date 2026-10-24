import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { DeliveryStatus, UserRole } from '../generated/prisma/client.js';
import { AccessTokenService } from '../auth/access-token.service.js';
import { CustomerAccessService } from '../auth/customer-access.service.js';
import { CustomerAccessGuard } from '../auth/customer-access.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CustomerFcmDeviceService } from '../customer/customer-fcm-device.service.js';
import { RiderPushDeviceService } from '../rider/rider-push-device.service.js';
import { RiderAvailabilityService } from '../rider/rider-availability.service.js';
import { BidService } from './bid.service.js';
import { BidAcceptanceService } from './bid-acceptance.service.js';
import { DeliveryController } from './delivery.controller.js';
import { DeliveryService } from './delivery.service.js';
import { DispatchService } from './dispatch.service.js';
import { remindLateV2Deliveries } from './v2-deadline-reminder.js';
import { V2_NOTICE_CLAIM_STALE_MS, V2_NOTICE_IDLE_MS } from './v2-notice.js';
import { V2OutboxSender } from './v2-outbox-sender.service.js';
import { V2PushSender, type V2PushMessage, type V2PushOutcome } from './v2-push-sender.js';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const PRISMA_CLI = require.resolve('prisma/build/index.js');
const HOST = '127.0.0.1';
const PORT = 54356;
const DATABASE = 'e2e_m5d';
const CONTAINER = 'riders-m5d-e2e-pg';
const DISPOSABLE_URL = `postgresql://postgres:postgres@${HOST}:${PORT}/${DATABASE}`;
const NOW = new Date('2026-10-24T08:00:00.000Z');
const DEADLINE = new Date('2026-10-24T18:00:00.000Z');
const LATE = new Date('2026-10-24T07:00:00.000Z');
const RIDER_LATITUDE = '-17.8012345';
const RIDER_LONGITUDE = '31.1098765';
const V2_STEPS = [
  DeliveryStatus.COLLECTING,
  DeliveryStatus.COLLECTED,
  DeliveryStatus.OUT_FOR_DELIVERY,
  DeliveryStatus.DELIVERED,
] as const;
const RECIPIENT_CHECK = `
ALTER TABLE "v2_outbox_events" DROP CONSTRAINT IF EXISTS "v2_outbox_events_recipient_chk";
ALTER TABLE "v2_outbox_events"
    ADD CONSTRAINT "v2_outbox_events_recipient_chk"
    CHECK (
        "attempt_count" >= 0
        AND (
            (
                "event_type" = 'BID_ACCEPTED'::"v2_outbox_event_type"
                AND "rider_profile_id" IS NOT NULL
                AND "customer_account_id" IS NULL
            )
            OR (
                "event_type" <> 'BID_ACCEPTED'::"v2_outbox_event_type"
                AND "customer_account_id" IS NOT NULL
                AND "rider_profile_id" IS NULL
            )
        )
    )`;

class RecordingSender extends V2PushSender {
  readonly messages: V2PushMessage[] = [];
  outcome: V2PushOutcome = 'accepted';
  delayMs = 0;
  ready = true;
  hold: Promise<void> | null = null;
  stealClaim: ((message: V2PushMessage) => Promise<void>) | null = null;

  configured(): boolean {
    return this.ready;
  }

  async send(message: V2PushMessage, timeoutMs: number): Promise<V2PushOutcome> {
    this.messages.push({ ...message });
    if (this.hold) await this.hold;
    if (this.stealClaim) await this.stealClaim(message);
    if (this.outcome === 'timeout' || this.delayMs > timeoutMs) return 'timeout';
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return this.outcome;
  }
}

let prisma: PrismaService;
let deliveries: DeliveryService;
let bids: BidService;
let acceptance: BidAcceptanceService;
let dispatch: DispatchService;
let availability: RiderAvailabilityService;
let devices: CustomerFcmDeviceService;
let riderDevices: RiderPushDeviceService;
let notices: V2OutboxSender;
let push: RecordingSender;
let customer: { userId: string; role: typeof UserRole.CUSTOMER; customerAccountId: string };
let adminId = '';
let phone = 792000100;
let registration = 9000;
let progressSequence = 0;
const previousDatabaseUrl = process.env.DATABASE_URL;
const previousFlag = process.env.V2_MARKETPLACE_ENABLED;
const previousSsl = process.env.DATABASE_SSL_CA;
const previousSecret = process.env.JWT_ACCESS_SECRET;
const previousMaxAttempts = process.env.V2_NOTICE_MAX_ATTEMPTS;

beforeAll(async () => {
  const parsed = new URL(DISPOSABLE_URL);
  if (parsed.hostname !== HOST || parsed.port !== String(PORT) || parsed.pathname !== `/${DATABASE}`) {
    throw new Error('Refusing to use a database that is not the disposable local Phase 5 end-to-end database');
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
  process.env.JWT_ACCESS_SECRET = '0123456789abcdef0123456789abcdef';
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
    for (const statement of sqlStatements(RECIPIENT_CHECK)) {
      await observer.query(statement);
    }
  } finally {
    await observer.end().catch(() => undefined);
  }
  prisma = new PrismaService();
  await prisma.$connect();
  deliveries = new DeliveryService(prisma, { metres: async () => 1_000 }, () => NOW);
  bids = new BidService(prisma);
  acceptance = new BidAcceptanceService(prisma);
  dispatch = new DispatchService(prisma);
  availability = new RiderAvailabilityService(prisma);
  devices = new CustomerFcmDeviceService(prisma);
  riderDevices = new RiderPushDeviceService(prisma);
  push = new RecordingSender();
  notices = new V2OutboxSender(prisma, push);
  const admin = await prisma.user.create({
    data: { fullName: 'Admin', phone: nextPhone(), role: UserRole.ADMIN, accountStatus: 'ACTIVE', phoneVerifiedAt: NOW },
  });
  adminId = admin.id;
  customer = await customerAccount('Owner');
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
    data: { rateVersion: 1, basisPoints: 1000, isActive: true, createdById: adminId },
  });
  await prisma.commissionPolicy.create({
    data: { policyVersion: 1, model: 'ON_COMPLETION', isActive: true, createdById: adminId },
  });
  await prisma.deliveryPricingConfig.create({
    data: {
      pricingVersion: 1,
      pricingModel: 'BASE_PLUS_PER_KILOMETRE',
      serviceClass: 'FLEXIBLE',
      currency: 'USD',
      baseFee: '1.00',
      pricePerKilometre: '0.50',
      minimumTripMetres: 0,
      maximumTripMetres: 100_000,
      isActive: true,
      createdById: adminId,
    },
  });
  await prisma.deliveryPricingConfig.create({
    data: {
      pricingVersion: 2,
      pricingModel: 'BASE_PLUS_PER_KILOMETRE',
      serviceClass: 'EXPRESS',
      currency: 'USD',
      baseFee: '2.00',
      pricePerKilometre: '0.80',
      minimumTripMetres: 0,
      maximumTripMetres: 100_000,
      isActive: true,
      createdById: adminId,
    },
  });
  await prisma.deliveryPricingConfig.create({
    data: {
      pricingVersion: 3,
      pricingModel: 'BASE_PLUS_PER_KILOMETRE',
      serviceClass: null,
      currency: 'USD',
      baseFee: '1.00',
      pricePerKilometre: '0.50',
      minimumTripMetres: 0,
      maximumTripMetres: 100_000,
      isActive: true,
      createdById: adminId,
    },
  });
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect().catch(() => undefined);
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  if (previousFlag === undefined) delete process.env.V2_MARKETPLACE_ENABLED;
  else process.env.V2_MARKETPLACE_ENABLED = previousFlag;
  if (previousSsl === undefined) delete process.env.DATABASE_SSL_CA;
  else process.env.DATABASE_SSL_CA = previousSsl;
  if (previousSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
  else process.env.JWT_ACCESS_SECRET = previousSecret;
  if (previousMaxAttempts === undefined) delete process.env.V2_NOTICE_MAX_ATTEMPTS;
  else process.env.V2_NOTICE_MAX_ATTEMPTS = previousMaxAttempts;
  await exec('docker', ['rm', '-f', CONTAINER], { windowsHide: true }).catch(() => undefined);
});

it('creates a Flexible request, accepts the bid, and reserves the agreed commission', async () => {
  const hired = await hire();
  const opened = await commit(hired, 'FLEXIBLE');
  expect(opened.reserved).toBe(true);
  expect(opened.commissionAmount).toBe('1.00');
  const delivery = await prisma.delivery.findUniqueOrThrow({ where: { id: opened.deliveryId } });
  expect(delivery.status).toBe('RIDER_ASSIGNED');
  expect(delivery.serviceClass).toBe('FLEXIBLE');
  expect(delivery.price?.toFixed(2)).toBe('10.00');
  const assignment = await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: opened.assignmentId } });
  expect(assignment.status).toBe('ACCEPTED');
  expect(assignment.acceptedBidAmount?.toFixed(2)).toBe('10.00');
  const reservation = await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: opened.assignmentId } });
  expect(reservation.status).toBe('OPEN');
  expect(reservation.amount.toFixed(2)).toBe('1.00');
  const wallet = await prisma.riderWallet.findUniqueOrThrow({ where: { id: hired.walletId } });
  expect(wallet.balance.toFixed(2)).toBe('0.00');
  const profile = await prisma.riderProfile.findUniqueOrThrow({ where: { id: hired.riderProfileId } });
  expect(profile.availability).toBe('AVAILABLE');
  expect(profile.receivingRequests).toBe(true);
  expect(await eventCount(opened.assignmentId, 'BID_ACCEPTED')).toBe(1);
});

it('progresses Flexible to delivered and captures that commission once', async () => {
  const hired = await hire();
  const opened = await commit(hired, 'FLEXIBLE');
  let deliveredKey = '';
  for (const status of V2_STEPS) {
    progressSequence += 1;
    const key = `step-${opened.deliveryId}-${status}-${progressSequence}`;
    if (status === DeliveryStatus.DELIVERED) deliveredKey = key;
    await dispatch.progress(hired.rider, opened.deliveryId, { status }, NOW, key);
  }
  const delivered = await prisma.delivery.findUniqueOrThrow({ where: { id: opened.deliveryId } });
  expect(delivered.status).toBe('DELIVERED');
  const assignment = await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: opened.assignmentId } });
  expect(assignment.status).toBe('COMPLETED');
  const reservation = await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: opened.assignmentId } });
  expect(reservation.status).toBe('CAPTURED');
  expect(await feeCount(opened.assignmentId)).toBe(1);
  const entry = await prisma.riderWalletEntry.findFirstOrThrow({
    where: { idempotencyKey: `platform-fee:assignment:${opened.assignmentId}` },
  });
  expect(entry.amount.toFixed(2)).toBe('-1.00');
  await dispatch.progress(hired.rider, opened.deliveryId, { status: 'DELIVERED' }, NOW, deliveredKey);
  expect(await feeCount(opened.assignmentId)).toBe(1);
  expect(await eventCount(opened.assignmentId, 'DELIVERED')).toBe(1);
  for (const eventType of ['COLLECTING', 'COLLECTED', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
    expect(await eventCount(opened.assignmentId, eventType)).toBe(1);
  }
});

it('completes a zero-percent delivery without a reservation or a ledger deduction', async () => {
  await setRate(0);
  try {
    const hired = await hire();
    const opened = await commit(hired, 'FLEXIBLE');
    expect(opened.reserved).toBe(false);
    expect(opened.commissionAmount).toBe('0.00');
    expect(await prisma.walletFeeReservation.count({ where: { assignmentId: opened.assignmentId } })).toBe(0);
    for (const status of V2_STEPS) {
      await step(hired.rider, opened.deliveryId, status);
    }
    const delivered = await prisma.delivery.findUniqueOrThrow({ where: { id: opened.deliveryId } });
    expect(delivered.status).toBe('DELIVERED');
    expect(await prisma.riderWalletEntry.count({ where: { riderWalletId: hired.walletId } })).toBe(0);
    expect(await eventCount(opened.assignmentId, 'DELIVERED')).toBe(1);
  } finally {
    await setRate(1000);
  }
});

it('progresses several Flexible deliveries independently, including parcels still awaiting pickup', async () => {
  const hired = await hire();
  const first = await commit(hired, 'FLEXIBLE');
  const second = await commit(hired, 'FLEXIBLE');
  const third = await commit(hired, 'FLEXIBLE');
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: first.deliveryId } })).status).toBe('RIDER_ASSIGNED');
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: second.deliveryId } })).status).toBe('RIDER_ASSIGNED');
  await step(hired.rider, first.deliveryId, DeliveryStatus.COLLECTING);
  await step(hired.rider, first.deliveryId, DeliveryStatus.COLLECTED);
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: first.deliveryId } })).status).toBe('COLLECTED');
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: second.deliveryId } })).status).toBe('RIDER_ASSIGNED');
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: third.deliveryId } })).status).toBe('RIDER_ASSIGNED');
  const reservations = await prisma.walletFeeReservation.findMany({
    where: { assignmentId: { in: [first.assignmentId, second.assignmentId, third.assignmentId] } },
  });
  expect(reservations).toHaveLength(3);
  expect(reservations.every((row) => row.status === 'OPEN')).toBe(true);
});

it('accepts Express beside Flexible, blocks new commitments, and resumes after Express is delivered', async () => {
  const hired = await hire();
  const flexible = await commit(hired, 'FLEXIBLE');
  const express = await commit(hired, 'EXPRESS');
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: express.deliveryId } })).serviceClass).toBe('EXPRESS');
  await expect(commit(hired, 'FLEXIBLE')).rejects.toThrow('You cannot submit a bid while an Express delivery is active');
  const blocked = await openRequest('FLEXIBLE');
  await expect(bids.submit(hired.rider, { deliveryId: blocked, amountCents: 1000 }, `bid-${blocked}`, NOW))
    .rejects.toThrow('You cannot submit a bid while an Express delivery is active');
  await step(hired.rider, flexible.deliveryId, DeliveryStatus.COLLECTING);
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: flexible.deliveryId } })).status).toBe('COLLECTING');
  for (const status of V2_STEPS) {
    await step(hired.rider, express.deliveryId, status);
  }
  expect((await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: express.assignmentId } })).status).toBe('COMPLETED');
  const resumed = await commit(hired, 'FLEXIBLE');
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: resumed.deliveryId } })).status).toBe('RIDER_ASSIGNED');
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: flexible.deliveryId } })).status).toBe('COLLECTING');
  expect((await prisma.riderProfile.findUniqueOrThrow({ where: { id: hired.riderProfileId } })).receivingRequests).toBe(true);
});

it('cancels before pickup, releases only that reservation, and refuses cancellation after collection', async () => {
  const hired = await hire();
  const assigned = await commit(hired, 'FLEXIBLE');
  const collecting = await commit(hired, 'FLEXIBLE');
  const kept = await commit(hired, 'FLEXIBLE');
  await step(hired.rider, collecting.deliveryId, DeliveryStatus.COLLECTING);
  await dispatch.cancelBeforePickup(hired.rider, assigned.assignmentId, `cancel-${assigned.assignmentId}`, { reason: 'BREAKDOWN' }, NOW);
  const reopened = await prisma.delivery.findUniqueOrThrow({ where: { id: assigned.deliveryId } });
  expect(reopened.status).toBe('CREATED');
  expect(await eventCount(assigned.assignmentId, 'REQUEST_REOPENED')).toBe(1);
  expect((await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: assigned.assignmentId } })).status).toBe('RELEASED');

  await dispatch.cancel(customer, collecting.deliveryId, NOW);
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: collecting.deliveryId } })).status).toBe('CANCELLED');
  expect(await eventCount(collecting.assignmentId, 'REQUEST_REOPENED')).toBe(0);
  expect((await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: collecting.assignmentId } })).status).toBe('RELEASED');
  expect((await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: kept.assignmentId } })).status).toBe('OPEN');

  const collected = await commit(hired, 'FLEXIBLE');
  await step(hired.rider, collected.deliveryId, DeliveryStatus.COLLECTING);
  await step(hired.rider, collected.deliveryId, DeliveryStatus.COLLECTED);
  await expect(dispatch.cancel(customer, collected.deliveryId, NOW)).rejects.toThrow('This delivery cannot be cancelled');
  await expect(dispatch.cancelBeforePickup(hired.rider, collected.assignmentId, `late-${collected.assignmentId}`, { reason: 'BREAKDOWN' }, NOW))
    .rejects.toThrow('This delivery cannot be cancelled');
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: collected.deliveryId } })).status).toBe('COLLECTED');

  const expired = await commit(hired, 'FLEXIBLE');
  await dispatch.cancelBeforePickup(hired.rider, expired.assignmentId, `deadline-${expired.assignmentId}`, { reason: 'BREAKDOWN' }, DEADLINE);
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: expired.deliveryId } })).status).toBe('CANCELLED');
  expect(await eventCount(expired.assignmentId, 'REQUEST_REOPENED')).toBe(0);
});

it('keeps concurrent cancellation and collection to one consistent outcome', async () => {
  const hired = await hire();
  const opened = await commit(hired, 'FLEXIBLE');
  await step(hired.rider, opened.deliveryId, DeliveryStatus.COLLECTING);
  const results = await Promise.allSettled([
    dispatch.cancel(customer, opened.deliveryId, NOW),
    dispatch.progress(hired.rider, opened.deliveryId, { status: 'COLLECTED' }, NOW, `race-${opened.deliveryId}`),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const delivery = await prisma.delivery.findUniqueOrThrow({ where: { id: opened.deliveryId } });
  const assignment = await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: opened.assignmentId } });
  if (delivery.status === 'CANCELLED') {
    expect(assignment.status).toBe('RELEASED');
    expect(await eventCount(opened.assignmentId, 'COLLECTED')).toBe(0);
  } else {
    expect(delivery.status).toBe('COLLECTED');
    expect(assignment.status).toBe('ACCEPTED');
    expect(await eventCount(opened.assignmentId, 'COLLECTED')).toBe(1);
  }
});

it('lets an offline or paused rider finish the current delivery and refuse a new commitment', async () => {
  const hired = await hire();
  const opened = await commit(hired, 'FLEXIBLE');
  expect((await prisma.riderProfile.findUniqueOrThrow({ where: { id: hired.riderProfileId } })).receivingRequests).toBe(true);
  await availability.setReceiving(hired.rider, { receiving: false }, NOW);
  await step(hired.rider, opened.deliveryId, DeliveryStatus.COLLECTING);
  await expect(commit(hired, 'FLEXIBLE')).rejects.toThrow('This rider is not receiving requests');
  expect((await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: opened.assignmentId } })).status).toBe('ACCEPTED');
  await availability.setReceiving(hired.rider, { receiving: true }, NOW);
  await availability.offline(hired.rider, NOW);
  const paused = await prisma.riderProfile.findUniqueOrThrow({ where: { id: hired.riderProfileId } });
  expect(paused.availability).toBe('OFFLINE');
  expect(paused.receivingRequests).toBe(false);
  await step(hired.rider, opened.deliveryId, DeliveryStatus.COLLECTED);
  await expect(commit(hired, 'FLEXIBLE')).rejects.toThrow('This rider is not available');
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: opened.deliveryId } })).status).toBe('COLLECTED');
});

it('keeps V1 acceptance and V2 acceptance isolated', async () => {
  const v2Rider = await hire();
  await commit(v2Rider, 'FLEXIBLE');
  const v2Offer = await offerV1(v2Rider);
  await expect(dispatch.accept(v2Rider.rider, v2Offer.assignmentId, `v1-${v2Offer.assignmentId}`, NOW))
    .rejects.toThrow('You already have an accepted delivery');

  const v1Rider = await hire();
  const offer = await offerV1(v1Rider);
  const accepted = await dispatch.accept(v1Rider.rider, offer.assignmentId, `v1-${offer.assignmentId}`, NOW);
  expect(accepted.availability).toBe('BUSY');
  const profile = await prisma.riderProfile.findUniqueOrThrow({ where: { id: v1Rider.riderProfileId } });
  expect(profile.availability).toBe('BUSY');
  const deliveryId = await openRequest('FLEXIBLE');
  const submitted = await bids.submit(v1Rider.rider, { deliveryId, amountCents: 1000 }, `bid-${deliveryId}`, NOW);
  await expect(acceptance.accept(customer, deliveryId, submitted.id, `accept-${deliveryId}`, NOW))
    .rejects.toThrow('This rider already has an accepted delivery');
});

it('shows the rider point only on the collecting delivery for that customer', async () => {
  const hired = await hire();
  const first = await commit(hired, 'FLEXIBLE');
  const second = await commit(hired, 'FLEXIBLE');
  await storePoint(hired.riderProfileId);
  const assigned = await deliveries.getById(customer, first.deliveryId);
  expect(assigned).not.toHaveProperty('riderLocation');
  expect(JSON.stringify(assigned)).not.toContain(RIDER_LATITUDE);

  await step(hired.rider, first.deliveryId, DeliveryStatus.COLLECTING);
  const collecting = await deliveries.getById(customer, first.deliveryId);
  expect(collecting.riderLocation).toEqual({ latitude: RIDER_LATITUDE, longitude: RIDER_LONGITUDE });
  const waiting = await deliveries.getById(customer, second.deliveryId);
  expect(waiting).not.toHaveProperty('riderLocation');
  expect(JSON.stringify(waiting)).not.toContain(RIDER_LATITUDE);

  const listed = await deliveries.list(customer, {});
  expect(JSON.stringify(listed)).not.toContain(RIDER_LATITUDE);

  const seen: number[] = [];
  const places = {
    deliveryMap: async (pickupLatitude: number, pickupLongitude: number, dropoffLatitude: number, dropoffLongitude: number) => {
      seen.push(pickupLatitude, pickupLongitude, dropoffLatitude, dropoffLongitude);
      return new Uint8Array([1, 2, 3]);
    },
  };
  const controller = new DeliveryController(deliveries, dispatch, places as never);
  await controller.map({ customer } as never, first.deliveryId);
  expect(seen).toHaveLength(4);
  expect(seen.map(String)).not.toContain(RIDER_LATITUDE);
  expect(seen.map(String)).not.toContain(RIDER_LONGITUDE);

  await step(hired.rider, first.deliveryId, DeliveryStatus.COLLECTED);
  const collected = await deliveries.getById(customer, first.deliveryId);
  expect(collected).not.toHaveProperty('riderLocation');
  expect(JSON.stringify(collected)).not.toContain(RIDER_LATITUDE);

  const other = await customerAccount('Other');
  await expect(deliveries.getById(other, first.deliveryId)).rejects.toThrow('Delivery not found');
  await expect(deliveries.getById(
    { userId: hired.rider.userId, role: UserRole.RIDER, customerAccountId: customer.customerAccountId },
    first.deliveryId,
  )).rejects.toBeInstanceOf(ForbiddenException);

  const tokens = new AccessTokenService();
  const clock = new Date();
  const session = await prisma.refreshSession.create({
    data: {
      userId: hired.rider.userId,
      familyId: randomUUID(),
      tokenHash: randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
      expiresAt: new Date(clock.getTime() + 3_600_000),
      familyExpiresAt: new Date(clock.getTime() + 86_400_000),
    },
  });
  const header = `Bearer ${tokens.sign({ sub: hired.rider.userId, role: UserRole.RIDER, sid: session.id }, clock).token}`;
  const access = new CustomerAccessService(prisma, tokens);
  await expect(access.authenticateAccount(header, clock)).rejects.toThrow('Customer access is required');
  const guard = new CustomerAccessGuard(access);
  await expect(guard.canActivate({
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: header } }) }),
  } as never)).rejects.toThrow('Customer access is required');
});

it('writes one notice per committed transition and leaves parcel state unchanged while sending', async () => {
  const hired = await hire();
  const opened = await commit(hired, 'FLEXIBLE');
  const key = `replay-${opened.deliveryId}`;
  await Promise.all([
    dispatch.progress(hired.rider, opened.deliveryId, { status: 'COLLECTING' }, NOW, key),
    dispatch.progress(hired.rider, opened.deliveryId, { status: 'COLLECTING' }, NOW, key),
  ]);
  expect(await eventCount(opened.assignmentId, 'COLLECTING')).toBe(1);
  await dispatch.progress(hired.rider, opened.deliveryId, { status: 'COLLECTING' }, NOW, key);
  expect(await eventCount(opened.assignmentId, 'COLLECTING')).toBe(1);

  await step(hired.rider, opened.deliveryId, DeliveryStatus.COLLECTED);
  await step(hired.rider, opened.deliveryId, DeliveryStatus.OUT_FOR_DELIVERY);
  await installWalletRefusal();
  try {
    await expect(step(hired.rider, opened.deliveryId, DeliveryStatus.DELIVERED)).rejects.toThrow();
  } finally {
    await removeWalletRefusal();
  }
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: opened.deliveryId } })).status).toBe('OUT_FOR_DELIVERY');
  expect(await feeCount(opened.assignmentId)).toBe(0);
  expect(await eventCount(opened.assignmentId, 'DELIVERED')).toBe(0);
  await step(hired.rider, opened.deliveryId, DeliveryStatus.DELIVERED);
  expect(await feeCount(opened.assignmentId)).toBe(1);
  expect(await eventCount(opened.assignmentId, 'DELIVERED')).toBe(1);

  const late = await commit(hired, 'FLEXIBLE');
  await prisma.delivery.update({ where: { id: late.deliveryId }, data: { deliverBy: LATE } });
  const reminders = await Promise.all([
    remindLateV2Deliveries(prisma, NOW),
    remindLateV2Deliveries(prisma, NOW),
  ]);
  expect(reminders.reduce((total, count) => total + count, 0)).toBe(1);
  expect(await eventCount(late.assignmentId, 'DEADLINE_REMINDER')).toBe(1);
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: late.deliveryId } })).status).toBe('RIDER_ASSIGNED');
  for (const status of V2_STEPS) {
    await step(hired.rider, late.deliveryId, status);
  }
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: late.deliveryId } })).status).toBe('DELIVERED');
  expect(await eventCount(late.assignmentId, 'DEADLINE_REMINDER')).toBe(1);

  await riderDevices.register(hired.rider, `rider-token-${opened.assignmentId}`);
  await devices.register(customer, `customer-token-${opened.assignmentId}`);
  push.messages.length = 0;
  push.outcome = 'accepted';
  push.ready = true;
  await parkPendingExcept([opened.assignmentId, late.assignmentId]);
  const before = await noticeEffects(opened.deliveryId, opened.assignmentId, hired.walletId);
  const sent = await notices.drain(NOW, 20);
  expect(sent).toBeGreaterThan(0);
  expect(push.messages.some((message) => message.type === 'v2_bid_accepted')).toBe(true);
  expect(push.messages.some((message) => message.type === 'v2_delivered')).toBe(true);
  expect(push.messages.some((message) => message.type === 'v2_deadline_reminder')).toBe(true);
  expect(push.messages.some((message) => message.type === 'rider_offer')).toBe(false);
  expect(await noticeEffects(opened.deliveryId, opened.assignmentId, hired.walletId)).toEqual(before);

  const retry = await commit(hired, 'FLEXIBLE');
  await markAcceptedSent(retry.assignmentId);
  await step(hired.rider, retry.deliveryId, DeliveryStatus.COLLECTING);
  await parkPendingExcept([retry.assignmentId]);
  push.messages.length = 0;
  push.outcome = 'temporary';
  const effects = await noticeEffects(retry.deliveryId, retry.assignmentId, hired.walletId);
  expect(await notices.drain(NOW, 5)).toBe(1);
  const retried = await prisma.v2OutboxEvent.findFirstOrThrow({
    where: { assignmentId: retry.assignmentId, eventType: 'COLLECTING' },
  });
  expect(retried.status).toBe('PENDING');
  expect(retried.attemptCount).toBe(1);
  expect(retried.lastFailure).toBe('provider_unavailable');
  expect(retried.claimToken).toBeNull();
  expect(await noticeEffects(retry.deliveryId, retry.assignmentId, hired.walletId)).toEqual(effects);

  push.outcome = 'timeout';
  expect(await notices.drain(new Date(NOW.getTime() + 3_000), 5)).toBe(1);
  const timed = await prisma.v2OutboxEvent.findFirstOrThrow({
    where: { assignmentId: retry.assignmentId, eventType: 'COLLECTING' },
  });
  expect(timed.attemptCount).toBe(2);
  expect(timed.lastFailure).toBe('provider_timeout');
  expect(timed.failedAt).toBeNull();

  process.env.V2_NOTICE_MAX_ATTEMPTS = '2';
  try {
    push.outcome = 'temporary';
    expect(await notices.drain(new Date(NOW.getTime() + 20_000), 5)).toBe(1);
  } finally {
    delete process.env.V2_NOTICE_MAX_ATTEMPTS;
  }
  const failed = await prisma.v2OutboxEvent.findFirstOrThrow({
    where: { assignmentId: retry.assignmentId, eventType: 'COLLECTING' },
  });
  expect(failed.status).toBe('FAILED');
  expect(failed.failedAt).not.toBeNull();
  push.messages.length = 0;
  expect(await notices.drain(new Date(NOW.getTime() + 60_000), 5)).toBe(0);
  expect(push.messages).toHaveLength(0);

  const abandoned = await commit(hired, 'FLEXIBLE');
  await markAcceptedSent(abandoned.assignmentId);
  await step(hired.rider, abandoned.deliveryId, DeliveryStatus.COLLECTING);
  const claimedAt = NOW;
  const staleToken = randomUUID();
  await prisma.v2OutboxEvent.updateMany({
    where: { assignmentId: abandoned.assignmentId, eventType: 'COLLECTING' },
    data: { claimedAt, claimToken: staleToken, status: 'PENDING' },
  });
  push.outcome = 'accepted';
  push.messages.length = 0;
  expect(await notices.drain(new Date(claimedAt.getTime() + V2_NOTICE_CLAIM_STALE_MS - 1_000), 5)).toBe(0);
  expect(await notices.drain(new Date(claimedAt.getTime() + V2_NOTICE_CLAIM_STALE_MS + 1_000), 5)).toBe(1);
  expect((await prisma.v2OutboxEvent.findFirstOrThrow({
    where: { assignmentId: abandoned.assignmentId, eventType: 'COLLECTING' },
  })).status).toBe('SENT');

  const fenced = await commit(hired, 'FLEXIBLE');
  await markAcceptedSent(fenced.assignmentId);
  await step(hired.rider, fenced.deliveryId, DeliveryStatus.COLLECTING);
  await parkPendingExcept([fenced.assignmentId]);
  const replacement = randomUUID();
  push.outcome = 'accepted';
  push.messages.length = 0;
  push.stealClaim = async (message) => {
    await prisma.v2OutboxEvent.updateMany({
      where: { assignmentId: message.assignmentId, eventType: 'COLLECTING', status: 'PENDING' },
      data: { claimToken: replacement, claimedAt: NOW },
    });
  };
  try {
    expect(await notices.drain(new Date(NOW.getTime() + 300_000), 5)).toBe(1);
  } finally {
    push.stealClaim = null;
  }
  const stolen = await prisma.v2OutboxEvent.findFirstOrThrow({
    where: { assignmentId: fenced.assignmentId, eventType: 'COLLECTING' },
  });
  expect(stolen.status).toBe('PENDING');
  expect(stolen.claimToken).toBe(replacement);
  expect(stolen.attemptCount).toBe(0);
  expect(await notices.drain(new Date(NOW.getTime() + 300_000 + V2_NOTICE_CLAIM_STALE_MS + 1_000), 5)).toBe(1);
  expect((await prisma.v2OutboxEvent.findFirstOrThrow({
    where: { assignmentId: fenced.assignmentId, eventType: 'COLLECTING' },
  })).status).toBe('SENT');

  const quiet = await commit(hired, 'FLEXIBLE');
  await markAcceptedSent(quiet.assignmentId);
  await step(hired.rider, quiet.deliveryId, DeliveryStatus.COLLECTING);
  await parkPendingExcept([quiet.assignmentId]);
  await prisma.customerFcmDevice.deleteMany({ where: { customerAccountId: customer.customerAccountId } });
  push.messages.length = 0;
  push.ready = true;
  expect(await notices.drain(new Date(NOW.getTime() + 120_000), 5)).toBe(1);
  const missing = await prisma.v2OutboxEvent.findFirstOrThrow({
    where: { assignmentId: quiet.assignmentId, eventType: 'COLLECTING' },
  });
  expect(missing.status).toBe('PENDING');
  expect(missing.attemptCount).toBe(0);
  expect(missing.lastFailure).toBeNull();
  expect(missing.nextAttemptAt?.getTime()).toBe(new Date(NOW.getTime() + 120_000 + V2_NOTICE_IDLE_MS).getTime());

  push.ready = false;
  push.messages.length = 0;
  expect(await notices.drain(new Date(NOW.getTime() + 200_000), 5)).toBe(1);
  const unconfigured = await prisma.v2OutboxEvent.findFirstOrThrow({
    where: { assignmentId: quiet.assignmentId, eventType: 'COLLECTING' },
  });
  expect(unconfigured.attemptCount).toBe(0);
  expect(unconfigured.lastFailure).toBeNull();
  expect(push.messages).toHaveLength(0);
  push.ready = true;
});

it('keeps the original V1 chain, one accepted assignment, release, and customer tracking', async () => {
  const hired = await hire();
  const offer = await offerV1(hired);
  const accepted = await dispatch.accept(hired.rider, offer.assignmentId, `v1-chain-${offer.assignmentId}`, NOW);
  expect(accepted.availability).toBe('BUSY');
  const chain = ['ARRIVED_AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DROPOFF', 'DELIVERED'] as const;
  for (const status of chain) {
    await dispatch.progress(hired.rider, offer.deliveryId, { status }, NOW);
  }
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: offer.deliveryId } })).status).toBe('DELIVERED');
  expect(await prisma.v2OutboxEvent.count({ where: { assignmentId: offer.assignmentId } })).toBe(0);
  const captured = await prisma.riderWalletEntry.findFirstOrThrow({
    where: { idempotencyKey: `platform-fee:${offer.deliveryId}` },
  });
  expect(captured.amount.toFixed(2)).toBe('-1.50');
  expect((await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: offer.assignmentId } })).status).toBe('CAPTURED');

  const releasedRider = await hire();
  const releasedOffer = await offerV1(releasedRider);
  await dispatch.accept(releasedRider.rider, releasedOffer.assignmentId, `v1-release-${releasedOffer.assignmentId}`, NOW);
  await dispatch.release(releasedRider.rider, releasedOffer.assignmentId, { reason: 'VEHICLE_PROBLEM' }, NOW);
  expect((await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: releasedOffer.assignmentId } })).status).toBe('RELEASED');
  expect((await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: releasedOffer.assignmentId } })).status).toBe('RELEASED');
  expect(await prisma.riderWalletEntry.count({ where: { riderWalletId: releasedRider.walletId } })).toBe(0);

  const tracked = await hire();
  const trackedOffer = await offerV1(tracked);
  await dispatch.accept(tracked.rider, trackedOffer.assignmentId, `v1-track-${trackedOffer.assignmentId}`, NOW);
  await storePoint(tracked.riderProfileId);
  const assigned = await deliveries.getById(customer, trackedOffer.deliveryId);
  expect(assigned.status).toBe('ASSIGNED');
  expect(assigned).not.toHaveProperty('riderLocation');
  await dispatch.progress(tracked.rider, trackedOffer.deliveryId, { status: 'ARRIVED_AT_PICKUP' }, NOW);
  const arrived = await deliveries.getById(customer, trackedOffer.deliveryId);
  expect(arrived.status).toBe('ARRIVED_AT_PICKUP');
  expect(arrived).not.toHaveProperty('riderLocation');
  expect(JSON.stringify(arrived)).not.toContain(RIDER_LATITUDE);

  const duplicate = await prisma.delivery.create({
    data: {
      customerId: customer.customerAccountId,
      pickupAddress: 'Second pickup',
      pickupCoordinateSource: 'DEVICE_GEOCODER',
      pickupContactName: 'Sender',
      pickupContactPhone: '+263770000001',
      dropoffAddress: 'Second dropoff',
      dropoffCoordinateSource: 'DEVICE_GEOCODER',
      parcelDescription: 'Parcel',
      parcelSize: 'SMALL',
      recipientName: 'Recipient',
      recipientPhone: '+263770000002',
      suggestedPrice: '6.00',
      price: '6.00',
      payer: 'SENDER',
      paymentMethod: 'CASH',
      distanceMeters: 1_000,
      pricingVersion: 3,
      currency: 'USD',
      status: 'SEARCHING',
      searchGeneration: 1,
    },
  });
  const motorcycle = await prisma.motorcycle.findFirstOrThrow({ where: { riderProfileId: tracked.riderProfileId } });
  const client = new pg.Client({ connectionString: DISPOSABLE_URL });
  await client.connect();
  try {
    await expect(client.query(
      `INSERT INTO "delivery_assignments" (
         "id", "delivery_id", "rider_profile_id", "motorcycle_id", "status", "offer_expires_at",
         "accepted_platform_fee", "accepted_fee_config_version"
       )
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, 'ACCEPTED', $4::timestamptz, 1.50, 1)`,
      [duplicate.id, tracked.riderProfileId, motorcycle.id, new Date(NOW.getTime() + 60_000)],
    )).rejects.toMatchObject({ code: '23505', constraint: 'delivery_assignments_one_accepted_v1_per_rider_idx' });
  } finally {
    await client.end();
  }
});

it('keeps V1 APIs available and V2-only routes closed while the marketplace flag is off', async () => {
  delete process.env.V2_MARKETPLACE_ENABLED;
  try {
    const hired = await hire();
    hired.rider;
    await prisma.riderProfile.update({
      where: { id: hired.riderProfileId },
      data: { receivingRequests: null },
    });
    const created = await deliveries.create(customer, {
      ...requestBody('FLEXIBLE'),
      offeredPrice: '6.00',
      payer: 'SENDER',
      paymentMethod: 'CASH',
    });
    expect(created.status).toBe('CREATED');
    expect(created.serviceClass).toBeNull();
    await expect(bids.submit(hired.rider, { deliveryId: created.id, amountCents: 1000 }, `off-${created.id}`, NOW))
      .rejects.toThrow('Bidding is not available');
    await expect(acceptance.accept(customer, created.id, randomUUID(), `off-accept-${created.id}`, NOW))
      .rejects.toThrow('Bidding is not available');
    await expect(availability.setReceiving(hired.rider, { receiving: true }, NOW))
      .rejects.toThrow('Bidding is not available');
    await expect(devices.register(customer, 'flag-off-token')).rejects.toThrow('Bidding is not available');
    const offer = await offerV1(hired);
    const accepted = await dispatch.accept(hired.rider, offer.assignmentId, `flag-off-${offer.assignmentId}`, NOW);
    expect(accepted.availability).toBe('BUSY');
    await dispatch.progress(hired.rider, offer.deliveryId, { status: 'ARRIVED_AT_PICKUP' }, NOW);
    expect((await prisma.delivery.findUniqueOrThrow({ where: { id: offer.deliveryId } })).status).toBe('ARRIVED_AT_PICKUP');
    expect(await notices.drain(NOW, 5)).toBe(0);
  } finally {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
  }
});

it('serializes contested wallet capacity and keeps the documented lock order', async () => {
  const hired = await hire();
  await prisma.riderWallet.update({ where: { id: hired.walletId }, data: { borrowingLimitOverride: '1.00' } });
  const firstId = await openRequest('FLEXIBLE');
  const secondId = await openRequest('FLEXIBLE');
  const firstBid = await bids.submit(hired.rider, { deliveryId: firstId, amountCents: 1000 }, `cap-a-${firstId}`, NOW);
  const secondBid = await bids.submit(hired.rider, { deliveryId: secondId, amountCents: 1000 }, `cap-b-${secondId}`, NOW);
  const results = await Promise.allSettled([
    acceptance.accept(customer, firstId, firstBid.id, `cap-accept-${firstId}`, NOW),
    acceptance.accept(customer, secondId, secondBid.id, `cap-accept-${secondId}`, NOW),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((result) => result.status === 'rejected');
  expect(rejected?.status === 'rejected' ? rejected.reason.message : '').toBe('Wallet capacity is not enough for this bid');
  expect(await prisma.walletFeeReservation.count({
    where: { riderWalletId: hired.walletId, status: 'OPEN' },
  })).toBe(1);

  const source = readFileSync(new URL('./dispatch.service.ts', import.meta.url), 'utf8');
  const progress = source.slice(source.indexOf('async function progressDelivery'));
  const deliveryLock = progress.indexOf('await lockDelivery(');
  const riderLock = progress.indexOf('await lockRiderProfile(');
  const assignmentLock = progress.indexOf('await lockAssignment(');
  const capture = progress.indexOf('await captureV2CommissionReservation(');
  expect(deliveryLock).toBeGreaterThan(-1);
  expect(deliveryLock).toBeLessThan(riderLock);
  expect(riderLock).toBeLessThan(assignmentLock);
  expect(assignmentLock).toBeLessThan(capture);
  const acceptSource = readFileSync(new URL('./bid-acceptance.service.ts', import.meta.url), 'utf8');
  const acceptBody = acceptSource.slice(acceptSource.indexOf('private async acceptLocked('));
  expect(acceptBody.indexOf('await lockDelivery(')).toBeGreaterThan(-1);
  expect(acceptBody.indexOf('await lockDelivery(')).toBeLessThan(acceptBody.indexOf('await lockRiderProfile('));
});

async function commit(hired: Hired, serviceClass: 'FLEXIBLE' | 'EXPRESS') {
  const deliveryId = await openRequest(serviceClass);
  const submitted = await bids.submit(hired.rider, { deliveryId, amountCents: 1000 }, `bid-${deliveryId}`, NOW);
  const accepted = await acceptance.accept(customer, deliveryId, submitted.id, `accept-${deliveryId}`, NOW);
  return {
    deliveryId,
    assignmentId: accepted.assignmentId,
    bidId: submitted.id,
    reserved: accepted.reserved,
    commissionAmount: accepted.commissionAmount,
  };
}

async function openRequest(serviceClass: 'FLEXIBLE' | 'EXPRESS') {
  const created = await deliveries.create(customer, requestBody(serviceClass));
  return created.id;
}

function requestBody(serviceClass: 'FLEXIBLE' | 'EXPRESS') {
  return {
    serviceClass,
    deliverBy: DEADLINE.toISOString(),
    pickup: stop('Pickup road', -17.8292, 31.0522, '+263770000001'),
    dropoff: stop('Dropoff road', -17.821, 31.04, '+263770000002'),
    parcel: { description: 'Documents', size: 'SMALL' },
  };
}

function stop(address: string, latitude: number, longitude: number, contactPhone: string) {
  return {
    address,
    latitude,
    longitude,
    coordinateSource: 'DEVICE_GEOCODER',
    contactName: 'Sender',
    contactPhone,
  };
}

async function step(
  rider: { userId: string; riderProfileId: string },
  deliveryId: string,
  status: DeliveryStatus,
) {
  progressSequence += 1;
  return dispatch.progress(rider, deliveryId, { status }, NOW, `step-${deliveryId}-${status}-${progressSequence}`);
}

async function offerV1(hired: Hired) {
  await prisma.riderLocation.upsert({
    where: { riderProfileId: hired.riderProfileId },
    create: { riderProfileId: hired.riderProfileId, latitude: '-17.8292000', longitude: '31.0522000', updatedAt: NOW },
    update: { latitude: '-17.8292000', longitude: '31.0522000', updatedAt: NOW },
  });
  const delivery = await prisma.delivery.create({
    data: {
      customerId: customer.customerAccountId,
      pickupAddress: 'V1 Pickup road',
      pickupCoordinateSource: 'DEVICE_GEOCODER',
      pickupContactName: 'Sender',
      pickupContactPhone: '+263770000001',
      dropoffAddress: 'V1 Dropoff road',
      dropoffCoordinateSource: 'DEVICE_GEOCODER',
      parcelDescription: 'Parcel',
      parcelSize: 'SMALL',
      recipientName: 'Recipient',
      recipientPhone: '+263770000002',
      suggestedPrice: '6.00',
      price: '6.00',
      payer: 'SENDER',
      paymentMethod: 'CASH',
      distanceMeters: 1_000,
      pricingVersion: 3,
      currency: 'USD',
      status: 'SEARCHING',
      searchGeneration: 1,
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

async function storePoint(riderProfileId: string) {
  await prisma.riderLocation.upsert({
    where: { riderProfileId },
    create: { riderProfileId, latitude: RIDER_LATITUDE, longitude: RIDER_LONGITUDE, updatedAt: NOW },
    update: { latitude: RIDER_LATITUDE, longitude: RIDER_LONGITUDE, updatedAt: NOW },
  });
}

async function eventCount(assignmentId: string, eventType: string) {
  return prisma.v2OutboxEvent.count({ where: { assignmentId, eventType: eventType as never } });
}

async function feeCount(assignmentId: string) {
  return prisma.riderWalletEntry.count({ where: { idempotencyKey: `platform-fee:assignment:${assignmentId}` } });
}

async function noticeEffects(deliveryId: string, assignmentId: string, walletId: string) {
  const delivery = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
  const assignment = await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
  const reservation = await prisma.walletFeeReservation.findFirst({ where: { assignmentId } });
  const bid = await prisma.bid.findFirst({ where: { deliveryId, status: 'ACCEPTED' } });
  return {
    deliveryStatus: delivery.status,
    updatedAt: delivery.updatedAt.getTime(),
    assignmentStatus: assignment.status,
    reservationStatus: reservation?.status ?? null,
    bidStatus: bid?.status ?? null,
    ledger: await prisma.riderWalletEntry.count({ where: { riderWalletId: walletId } }),
  };
}

async function markAcceptedSent(assignmentId: string) {
  await prisma.v2OutboxEvent.updateMany({
    where: { assignmentId, eventType: 'BID_ACCEPTED' },
    data: { status: 'SENT', sentAt: NOW },
  });
}

async function parkPendingExcept(assignmentIds: string[]) {
  await prisma.v2OutboxEvent.updateMany({
    where: { status: 'PENDING', assignmentId: { notIn: assignmentIds } },
    data: { nextAttemptAt: new Date('2099-01-01T00:00:00.000Z') },
  });
}

async function installWalletRefusal() {
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "v2_notice_refuse_wallet" ON "rider_wallet_entries"');
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION "v2_notice_refuse_wallet"() RETURNS trigger
    LANGUAGE plpgsql AS $fn$
    BEGIN
      RAISE EXCEPTION 'wallet refused';
    END;
    $fn$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "v2_notice_refuse_wallet"
    BEFORE INSERT ON "rider_wallet_entries"
    FOR EACH ROW EXECUTE FUNCTION "v2_notice_refuse_wallet"()`);
}

async function removeWalletRefusal() {
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "v2_notice_refuse_wallet" ON "rider_wallet_entries"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS "v2_notice_refuse_wallet"()');
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

async function customerAccount(name: string) {
  const user = await prisma.user.create({
    data: { fullName: name, phone: nextPhone(), role: UserRole.CUSTOMER, accountStatus: 'ACTIVE', phoneVerifiedAt: NOW },
  });
  const account = await prisma.customerAccount.create({
    data: { userId: user.id, kind: 'INDIVIDUAL', name, address: 'Address road' },
  });
  return { userId: user.id, role: UserRole.CUSTOMER, customerAccountId: account.id };
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
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}
