import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DeliveryStatus, UserRole } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CustomerFcmDeviceService } from '../customer/customer-fcm-device.service.js';
import { RiderPushDeviceService } from '../rider/rider-push-device.service.js';
import { BidAcceptanceService } from './bid-acceptance.service.js';
import { DispatchService } from './dispatch.service.js';
import { remindLateV2Deliveries } from './v2-deadline-reminder.js';
import { V2_NOTICE_CLAIM_STALE_MS, V2_NOTICE_IDLE_MS, v2NoticeConfig } from './v2-notice.js';
import { V2OutboxSender } from './v2-outbox-sender.service.js';
import { V2PushSender, type V2PushMessage, type V2PushOutcome } from './v2-push-sender.js';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const PRISMA_CLI = require.resolve('prisma/build/index.js');
const HOST = '127.0.0.1';
const PORT = 54353;
const DATABASE = 'notify_m5c';
const CONTAINER = 'riders-m5c-notify-pg';
const DISPOSABLE_URL = `postgresql://postgres:postgres@${HOST}:${PORT}/${DATABASE}`;
const NOW = new Date('2026-10-24T08:00:00.000Z');
const DEADLINE = new Date('2026-10-24T18:00:00.000Z');
const LATE = new Date('2026-10-24T07:00:00.000Z');
const V2_STEPS = [
  DeliveryStatus.COLLECTED,
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
  lastTimeoutMs = 0;
  hold: Promise<void> | null = null;
  stealClaim: ((message: V2PushMessage) => Promise<void>) | null = null;

  configured(): boolean {
    return this.ready;
  }

  async send(message: V2PushMessage, timeoutMs: number): Promise<V2PushOutcome> {
    this.messages.push({ ...message });
    this.lastTimeoutMs = timeoutMs;
    if (this.hold) {
      await this.hold;
    }
    if (this.stealClaim) {
      await this.stealClaim(message);
    }
    if (this.outcome === 'timeout' || this.delayMs > timeoutMs) {
      return 'timeout';
    }
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    return this.outcome;
  }
}

let prisma: PrismaService;
let acceptance: BidAcceptanceService;
let dispatch: DispatchService;
let devices: CustomerFcmDeviceService;
let riderDevices: RiderPushDeviceService;
let notices: V2OutboxSender;
let push: RecordingSender;
let customer: { userId: string; role: typeof UserRole.CUSTOMER; customerAccountId: string };
let adminId = '';
let phone = 791000100;
let registration = 8000;
let progressSequence = 0;
const previousDatabaseUrl = process.env.DATABASE_URL;
const previousFlag = process.env.V2_MARKETPLACE_ENABLED;
const previousSsl = process.env.DATABASE_SSL_CA;

beforeAll(async () => {
  const parsed = new URL(DISPOSABLE_URL);
  if (parsed.hostname !== HOST || parsed.port !== String(PORT) || parsed.pathname !== `/${DATABASE}`) {
    throw new Error('Refusing to use a database that is not the disposable local Phase 5 notice database');
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
    for (const statement of sqlStatements(RECIPIENT_CHECK)) {
      await observer.query(statement);
    }
  } finally {
    await observer.end().catch(() => undefined);
  }
  prisma = new PrismaService();
  await prisma.$connect();
  acceptance = new BidAcceptanceService(prisma);
  dispatch = new DispatchService(prisma);
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
  await prisma.commissionPolicy.create({
    data: { policyVersion: 1, model: 'ON_COMPLETION', isActive: true, createdById: adminId },
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

it('writes one customer event for each V2 status, skips a replay, and rolls a failed delivery back', async () => {
  const hired = await hire();
  const opened = await acceptJob(hired, '10.00');
  await expect(prisma.v2OutboxEvent.create({
    data: {
      eventType: 'COLLECTED',
      deliveryId: opened.deliveryId,
      assignmentId: opened.assignmentId,
      riderProfileId: hired.riderProfileId,
    },
  })).rejects.toThrow();
  expect(await prisma.v2OutboxEvent.count({ where: { assignmentId: opened.assignmentId, eventType: 'COLLECTED' } })).toBe(0);
  await expect(step(hired.rider, opened.deliveryId, DeliveryStatus.COLLECTING)).rejects.toThrow('This delivery status cannot be changed');
  expect(await prisma.v2OutboxEvent.count({ where: { assignmentId: opened.assignmentId, eventType: 'COLLECTED' } })).toBe(0);

  const collectedKey = `collected-${opened.deliveryId}`;
  await dispatch.progress(hired.rider, opened.deliveryId, { status: 'COLLECTED' }, NOW, collectedKey);
  await dispatch.progress(hired.rider, opened.deliveryId, { status: 'COLLECTED' }, NOW, collectedKey);
  expect(await prisma.v2OutboxEvent.count({ where: { assignmentId: opened.assignmentId, eventType: 'COLLECTED' } })).toBe(1);

  for (const status of V2_STEPS.slice(1)) {
    await step(hired.rider, opened.deliveryId, status);
    expect(await prisma.v2OutboxEvent.count({ where: { assignmentId: opened.assignmentId, eventType: status } })).toBe(1);
  }
  const delivered = await prisma.v2OutboxEvent.findFirstOrThrow({
    where: { assignmentId: opened.assignmentId, eventType: 'DELIVERED' },
  });
  expect(delivered.customerAccountId).toBe(customer.customerAccountId);
  expect(delivered.riderProfileId).toBeNull();
  expect(delivered.status).toBe('PENDING');
  expect((await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: opened.assignmentId } })).status).toBe('CAPTURED');

  const rolled = await acceptJob(await hire(), '10.00');
  for (const status of V2_STEPS.slice(0, 1)) {
    await step(rolled.rider, rolled.deliveryId, status);
  }
  await installWalletRefusal();
  try {
    await expect(step(rolled.rider, rolled.deliveryId, DeliveryStatus.DELIVERED)).rejects.toThrow();
  } finally {
    await removeWalletRefusal();
  }
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: rolled.deliveryId } })).status).toBe('COLLECTED');
  expect(await prisma.v2OutboxEvent.count({ where: { assignmentId: rolled.assignmentId, eventType: 'DELIVERED' } })).toBe(0);
  expect((await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: rolled.assignmentId } })).status).toBe('OPEN');
  expect(await feeCount(rolled.assignmentId)).toBe(0);
  await step(rolled.rider, rolled.deliveryId, DeliveryStatus.DELIVERED);
  expect(await prisma.v2OutboxEvent.count({ where: { assignmentId: rolled.assignmentId, eventType: 'DELIVERED' } })).toBe(1);
  expect((await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: rolled.assignmentId } })).status).toBe('CAPTURED');
  expect(await feeCount(rolled.assignmentId)).toBe(1);
}, 60_000);

it('does not write a V2 status event when a stored legacy assignment stays assigned', async () => {
  const hired = await hire();
  const delivery = await prisma.delivery.create({
    data: {
      ...deliveryData(),
      serviceClass: null,
      deliverBy: null,
      status: 'ASSIGNED',
      searchGeneration: 1,
      price: '6.00',
      payer: 'SENDER',
      paymentMethod: 'CASH',
    },
  });
  const motorcycle = await prisma.motorcycle.findFirstOrThrow({
    where: { riderProfileId: hired.riderProfileId, isActive: true },
  });
  const assignment = await prisma.deliveryAssignment.create({
    data: {
      deliveryId: delivery.id,
      riderProfileId: hired.riderProfileId,
      motorcycleId: motorcycle.id,
      status: 'ACCEPTED',
      respondedAt: NOW,
      searchGeneration: 1,
      acceptedPlatformFee: '0.30',
      acceptedFeeConfigVersion: 1,
      acceptedCommissionModel: 'ON_COMPLETION',
      acceptedCommissionPolicyVersion: 1,
    },
  });
  await expect(dispatch.progress(hired.rider, delivery.id, { status: 'ARRIVED_AT_PICKUP' }, NOW))
    .rejects.toThrow('This delivery status cannot be changed');
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe('ASSIGNED');
  expect((await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: assignment.id } })).status).toBe('ACCEPTED');
  expect(await prisma.v2OutboxEvent.count({ where: { deliveryId: delivery.id } })).toBe(0);
}, 60_000);

it('keeps bid acceptance and request reopened notices and sends them with new payload types', async () => {
  const hired = await hire();
  const opened = await acceptJob(hired, '10.00');
  await acceptance.accept(customer, opened.deliveryId, opened.bidId, opened.acceptKey, NOW);
  expect(await prisma.v2OutboxEvent.count({ where: { assignmentId: opened.assignmentId, eventType: 'BID_ACCEPTED' } })).toBe(1);
  const reopened = await dispatch.cancelBeforePickup(
    hired.rider,
    opened.assignmentId,
    `cancel-${opened.assignmentId}`,
    { reason: 'BREAKDOWN' },
    NOW,
  );
  expect(reopened).toMatchObject({ status: 'CREATED', reopened: true });
  await dispatch.cancelBeforePickup(hired.rider, opened.assignmentId, `cancel-${opened.assignmentId}`, { reason: 'BREAKDOWN' }, NOW);
  expect(await prisma.v2OutboxEvent.count({ where: { assignmentId: opened.assignmentId, eventType: 'REQUEST_REOPENED' } })).toBe(1);
  const ledgerBefore = await prisma.riderWalletEntry.count({ where: { riderWalletId: hired.walletId } });
  await riderDevices.register(hired.rider, 'rider-device-token');
  await devices.register(customer, 'customer-reopen-token');
  await parkPendingExcept([opened.assignmentId]);
  push.messages.length = 0;
  push.outcome = 'accepted';
  await notices.drain(NOW);
  const types = push.messages.map((message) => message.type).sort();
  expect(types).toEqual(['v2_bid_accepted', 'v2_request_reopened']);
  expect(types).not.toContain('rider_offer');
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: opened.deliveryId } })).status).toBe('CREATED');
  expect(await prisma.riderWalletEntry.count({ where: { riderWalletId: hired.walletId } })).toBe(ledgerBefore);
  expect((await prisma.v2OutboxEvent.findFirstOrThrow({
    where: { assignmentId: opened.assignmentId, eventType: 'BID_ACCEPTED' },
  })).status).toBe('SENT');
  expect((await prisma.v2OutboxEvent.findFirstOrThrow({
    where: { assignmentId: opened.assignmentId, eventType: 'REQUEST_REOPENED' },
  })).sentAt).toBeTruthy();
}, 60_000);

it('writes one deadline reminder for a late active parcel and none for a finished parcel', async () => {
  const hired = await hire();
  const active = await lateParcel(hired, DeliveryStatus.COLLECTING);
  const collected = await lateParcel(hired, DeliveryStatus.COLLECTED);
  const travelling = await lateParcel(hired, DeliveryStatus.OUT_FOR_DELIVERY);
  const waiting = await lateParcel(hired, DeliveryStatus.RIDER_ASSIGNED);
  const delivered = await lateParcel(hired, DeliveryStatus.DELIVERED);
  const cancelled = await acceptJob(hired, '10.00');
  await dispatch.cancel(customer, cancelled.deliveryId, NOW);
  await prisma.delivery.update({ where: { id: cancelled.deliveryId }, data: { deliverBy: LATE } });

  const written = await remindLateV2Deliveries(prisma, NOW);
  expect(written).toBe(4);
  for (const parcel of [active, collected, travelling, waiting]) {
    const reminder = await prisma.v2OutboxEvent.findFirstOrThrow({
      where: { assignmentId: parcel.assignmentId, eventType: 'DEADLINE_REMINDER' },
    });
    expect(reminder.customerAccountId).toBe(customer.customerAccountId);
    expect(reminder.riderProfileId).toBeNull();
    expect((await prisma.delivery.findUniqueOrThrow({ where: { id: parcel.deliveryId } })).status).toBe(parcel.status);
    expect((await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: parcel.assignmentId } })).status).toBe(
      parcel.status === 'DELIVERED' ? 'COMPLETED' : 'ACCEPTED',
    );
    if (parcel.status !== 'DELIVERED') {
      expect((await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: parcel.assignmentId } })).status).toBe('OPEN');
    }
  }
  expect(await prisma.v2OutboxEvent.count({ where: { assignmentId: delivered.assignmentId, eventType: 'DEADLINE_REMINDER' } })).toBe(0);
  expect(await prisma.v2OutboxEvent.count({ where: { assignmentId: cancelled.assignmentId, eventType: 'DEADLINE_REMINDER' } })).toBe(0);
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: cancelled.deliveryId } })).status).toBe('CANCELLED');
  expect(await remindLateV2Deliveries(prisma, NOW)).toBe(0);
  expect(await prisma.v2OutboxEvent.count({ where: { assignmentId: active.assignmentId, eventType: 'DEADLINE_REMINDER' } })).toBe(1);

  process.env.V2_MARKETPLACE_ENABLED = 'false';
  try {
    expect(await remindLateV2Deliveries(prisma, NOW)).toBe(0);
  } finally {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
  }
}, 60_000);

it('lets concurrent reminder passes write one event and leaves the parcel active', async () => {
  const hired = await hire();
  const parcel = await lateParcel(hired, DeliveryStatus.COLLECTING);
  const ledgerBefore = await prisma.riderWalletEntry.count({ where: { riderWalletId: hired.walletId } });
  const results = await Promise.all([
    remindLateV2Deliveries(prisma, NOW),
    remindLateV2Deliveries(prisma, NOW),
  ]);
  expect(results.reduce((sum, count) => sum + count, 0)).toBe(1);
  expect(await prisma.v2OutboxEvent.count({ where: { assignmentId: parcel.assignmentId, eventType: 'DEADLINE_REMINDER' } })).toBe(1);
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: parcel.deliveryId } })).status).toBe('COLLECTING');
  expect((await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: parcel.assignmentId } })).status).toBe('ACCEPTED');
  expect((await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: parcel.assignmentId } })).status).toBe('OPEN');
  expect(await prisma.riderWalletEntry.count({ where: { riderWalletId: hired.walletId } })).toBe(ledgerBefore);
}, 60_000);

it('registers a customer FCM device for that customer only', async () => {
  const other = await customerAccount('Other');
  const hired = await hire();
  process.env.V2_MARKETPLACE_ENABLED = 'false';
  await expect(devices.register(customer, 'hidden-token')).rejects.toThrow('Bidding is not available');
  process.env.V2_MARKETPLACE_ENABLED = 'true';
  await expect(devices.register(
    { userId: hired.rider.userId, role: UserRole.RIDER, customerAccountId: customer.customerAccountId },
    'rider-role-token',
  )).rejects.toThrow('Customer access is required');
  await expect(devices.register(customer, '  ')).rejects.toThrow('FCM token is required');
  expect(await devices.register(customer, ' owner-token ')).toEqual({ registered: true });
  expect((await prisma.customerFcmDevice.findUniqueOrThrow({ where: { fcmToken: 'owner-token' } })).customerAccountId)
    .toBe(customer.customerAccountId);
  await devices.remove(other, 'owner-token');
  expect(await prisma.customerFcmDevice.findUnique({ where: { fcmToken: 'owner-token' } })).toBeTruthy();
  await devices.register(other, 'owner-token');
  expect((await prisma.customerFcmDevice.findUniqueOrThrow({ where: { fcmToken: 'owner-token' } })).customerAccountId)
    .toBe(other.customerAccountId);
  expect(await prisma.customerFcmDevice.count({ where: { fcmToken: 'owner-token' } })).toBe(1);
  await devices.remove(customer, 'owner-token');
  expect(await prisma.customerFcmDevice.findUnique({ where: { fcmToken: 'owner-token' } })).toBeTruthy();
  await devices.remove(other, 'owner-token');
  expect(await prisma.customerFcmDevice.findUnique({ where: { fcmToken: 'owner-token' } })).toBeNull();
  expect(await prisma.riderPushDevice.count({ where: { fcmToken: 'owner-token' } })).toBe(0);
  expect(await prisma.customerPushDevice.count()).toBe(0);
}, 60_000);

it('sends a status notice, retries a real failure, and leaves a missing device pending', async () => {
  const hired = await hire();
  const quiet = await acceptJob(hired, '10.00');
  await step(hired.rider, quiet.deliveryId, DeliveryStatus.COLLECTED);
  await markAcceptedSent(quiet.assignmentId);
  await prisma.customerFcmDevice.deleteMany();
  await parkPendingExcept([quiet.assignmentId]);
  push.messages.length = 0;
  push.outcome = 'accepted';
  await notices.drain(NOW);
  const quietRow = await prisma.v2OutboxEvent.findFirstOrThrow({
    where: { assignmentId: quiet.assignmentId, eventType: 'COLLECTED' },
  });
  expect(quietRow.status).toBe('PENDING');
  expect(quietRow.attemptCount).toBe(0);
  expect(quietRow.sentAt).toBeNull();
  expect(quietRow.nextAttemptAt?.getTime()).toBe(NOW.getTime() + V2_NOTICE_IDLE_MS);
  expect(push.messages).toHaveLength(0);
  expect((await prisma.delivery.findUniqueOrThrow({ where: { id: quiet.deliveryId } })).status).toBe('COLLECTED');

  await devices.register(customer, 'status-token');
  await notices.drain(new Date(NOW.getTime() + V2_NOTICE_IDLE_MS));
  const sent = await prisma.v2OutboxEvent.findFirstOrThrow({
    where: { assignmentId: quiet.assignmentId, eventType: 'COLLECTED' },
  });
  expect(sent.status).toBe('SENT');
  expect(sent.sentAt).toBeTruthy();
  expect(sent.attemptCount).toBe(0);
  expect(push.messages.map((message) => message.type)).toEqual(['v2_collected']);
  expect(push.messages[0]?.token).toBe('status-token');

  const failed = await acceptJob(await hire(), '10.00');
  await step(failed.rider, failed.deliveryId, DeliveryStatus.COLLECTED);
  await markAcceptedSent(failed.assignmentId);
  await parkPendingExcept([failed.assignmentId]);
  const ledgerBefore = await prisma.riderWalletEntry.count({ where: { riderWalletId: failed.walletId } });
  const deliveryBefore = await prisma.delivery.findUniqueOrThrow({ where: { id: failed.deliveryId } });
  push.messages.length = 0;
  push.outcome = 'temporary';
  await notices.drain(NOW);
  const retry = await prisma.v2OutboxEvent.findFirstOrThrow({
    where: { assignmentId: failed.assignmentId, eventType: 'COLLECTED' },
  });
  expect(retry.status).toBe('PENDING');
  expect(retry.attemptCount).toBe(1);
  expect(retry.claimedAt).toBeNull();
  expect(retry.lastFailure).toBe('provider_unavailable');
  expect(retry.failedAt).toBeNull();
  expect(retry.nextAttemptAt?.getTime()).toBe(NOW.getTime() + 2_000);
  await notices.drain(new Date(NOW.getTime() + 1_999));
  expect(push.messages).toHaveLength(1);
  push.outcome = 'accepted';
  await notices.drain(new Date(NOW.getTime() + 2_000));
  expect((await prisma.v2OutboxEvent.findFirstOrThrow({
    where: { assignmentId: failed.assignmentId, eventType: 'COLLECTED' },
  })).status).toBe('SENT');
  const deliveryAfter = await prisma.delivery.findUniqueOrThrow({ where: { id: failed.deliveryId } });
  expect(deliveryAfter.status).toBe('COLLECTED');
  expect(deliveryAfter.updatedAt.getTime()).toBe(deliveryBefore.updatedAt.getTime());
  expect((await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: failed.assignmentId } })).status).toBe('ACCEPTED');
  expect((await prisma.walletFeeReservation.findFirstOrThrow({ where: { assignmentId: failed.assignmentId } })).status).toBe('OPEN');
  expect(await prisma.riderWalletEntry.count({ where: { riderWalletId: failed.walletId } })).toBe(ledgerBefore);
  expect((await prisma.bid.findUniqueOrThrow({ where: { id: failed.bidId } })).status).toBe('ACCEPTED');

  process.env.V2_MARKETPLACE_ENABLED = 'false';
  try {
    const held = push.messages.length;
    expect(await notices.drain(new Date(NOW.getTime() + 3_000))).toBe(0);
    expect(push.messages).toHaveLength(held);
  } finally {
    process.env.V2_MARKETPLACE_ENABLED = 'true';
  }
}, 60_000);

it('claims distinct events concurrently and recovers an abandoned claim', async () => {
  const first = await acceptJob(await hire(), '10.00');
  const second = await acceptJob(await hire(), '11.00');
  await step(first.rider, first.deliveryId, DeliveryStatus.COLLECTED);
  await step(second.rider, second.deliveryId, DeliveryStatus.COLLECTED);
  await markAcceptedSent(first.assignmentId);
  await markAcceptedSent(second.assignmentId);
  await prisma.customerFcmDevice.deleteMany();
  await devices.register(customer, 'concurrent-token');
  await parkPendingExcept([first.assignmentId, second.assignmentId]);
  push.messages.length = 0;
  push.outcome = 'accepted';
  push.delayMs = 150;
  try {
    const claimed = await Promise.all([
      notices.drain(NOW, 1),
      notices.drain(NOW, 1),
    ]);
    expect(claimed.reduce((sum, count) => sum + count, 0)).toBe(2);
  } finally {
    push.delayMs = 0;
  }
  const sentIds = push.messages.map((message) => message.assignmentId).sort();
  expect(sentIds).toEqual([first.assignmentId, second.assignmentId].sort());
  expect(new Set(sentIds).size).toBe(2);
  expect(await prisma.v2OutboxEvent.count({
    where: { assignmentId: { in: [first.assignmentId, second.assignmentId] }, eventType: 'COLLECTED', status: 'SENT' },
  })).toBe(2);

  const abandoned = await acceptJob(await hire(), '12.00');
  await step(abandoned.rider, abandoned.deliveryId, DeliveryStatus.COLLECTED);
  await markAcceptedSent(abandoned.assignmentId);
  await parkPendingExcept([abandoned.assignmentId]);
  await prisma.v2OutboxEvent.updateMany({
    where: { assignmentId: abandoned.assignmentId, eventType: 'COLLECTED' },
    data: { claimedAt: NOW, claimToken: randomUUID() },
  });
  push.messages.length = 0;
  await notices.drain(NOW);
  expect(push.messages).toHaveLength(0);
  expect((await prisma.v2OutboxEvent.findFirstOrThrow({
    where: { assignmentId: abandoned.assignmentId, eventType: 'COLLECTED' },
  })).status).toBe('PENDING');
  await notices.drain(new Date(NOW.getTime() + V2_NOTICE_CLAIM_STALE_MS + 1));
  expect(push.messages.map((message) => message.assignmentId)).toEqual([abandoned.assignmentId]);
  const recovered = await prisma.v2OutboxEvent.findFirstOrThrow({
    where: { assignmentId: abandoned.assignmentId, eventType: 'COLLECTED' },
  });
  expect(recovered.status).toBe('SENT');
  expect(recovered.sentAt).toBeTruthy();
  expect(recovered.claimedAt).toBeNull();
}, 60_000);

it('keeps a claim while a provider response is still inside the timeout', async () => {
  const hired = await hire();
  const parcel = await acceptJob(hired, '10.00');
  await step(hired.rider, parcel.deliveryId, DeliveryStatus.COLLECTED);
  await markAcceptedSent(parcel.assignmentId);
  await prisma.customerFcmDevice.deleteMany();
  await devices.register(customer, 'slow-token');
  await parkPendingExcept([parcel.assignmentId]);
  const before = await noticeEffects(parcel.deliveryId, parcel.assignmentId, hired.walletId);
  const timing = v2NoticeConfig();
  expect(timing.timeoutMs * 8).toBeLessThanOrEqual(timing.leaseMs);
  let release = () => {};
  push.hold = new Promise((resolve) => {
    release = resolve;
  });
  push.outcome = 'accepted';
  push.messages.length = 0;
  const running = notices.drain(NOW);
  try {
    await waitForMessages(1);
    expect(push.lastTimeoutMs).toBe(timing.timeoutMs);
    expect(await notices.drain(new Date(NOW.getTime() + Math.floor(timing.leaseMs / 2)))).toBe(0);
    expect(push.messages).toHaveLength(1);
    const held = await prisma.v2OutboxEvent.findFirstOrThrow({
      where: { assignmentId: parcel.assignmentId, eventType: 'COLLECTED' },
    });
    expect(held.status).toBe('PENDING');
    expect(held.claimedAt).not.toBeNull();
    expect(held.attemptCount).toBe(0);
  } finally {
    release();
    push.hold = null;
  }
  await running;
  const sent = await prisma.v2OutboxEvent.findFirstOrThrow({
    where: { assignmentId: parcel.assignmentId, eventType: 'COLLECTED' },
  });
  expect(sent.status).toBe('SENT');
  expect(sent.sentAt).toBeTruthy();
  expect(push.messages).toHaveLength(1);
  expect(await noticeEffects(parcel.deliveryId, parcel.assignmentId, hired.walletId)).toEqual(before);
}, 60_000);

it('counts a provider timeout as a genuine failure and fences a replaced claim', async () => {
  const hired = await hire();
  const timedOut = await acceptJob(hired, '10.00');
  await step(hired.rider, timedOut.deliveryId, DeliveryStatus.COLLECTED);
  await markAcceptedSent(timedOut.assignmentId);
  await prisma.customerFcmDevice.deleteMany();
  await devices.register(customer, 'timeout-token');
  await parkPendingExcept([timedOut.assignmentId]);
  const before = await noticeEffects(timedOut.deliveryId, timedOut.assignmentId, hired.walletId);
  push.messages.length = 0;
  push.outcome = 'timeout';
  await notices.drain(NOW);
  const row = await prisma.v2OutboxEvent.findFirstOrThrow({
    where: { assignmentId: timedOut.assignmentId, eventType: 'COLLECTED' },
  });
  expect(row.status).toBe('PENDING');
  expect(row.attemptCount).toBe(1);
  expect(row.lastFailure).toBe('provider_timeout');
  expect(row.lastAttemptAt?.getTime()).toBe(NOW.getTime());
  expect(row.failedAt).toBeNull();
  expect(row.claimedAt).toBeNull();
  expect(await noticeEffects(timedOut.deliveryId, timedOut.assignmentId, hired.walletId)).toEqual(before);

  const fenced = await acceptJob(await hire(), '11.00');
  await step(fenced.rider, fenced.deliveryId, DeliveryStatus.COLLECTED);
  await markAcceptedSent(fenced.assignmentId);
  await parkPendingExcept([fenced.assignmentId]);
  const fencedBefore = await noticeEffects(fenced.deliveryId, fenced.assignmentId, fenced.walletId);
  const replacement = randomUUID();
  push.outcome = 'accepted';
  push.messages.length = 0;
  push.stealClaim = async (message) => {
    await prisma.v2OutboxEvent.updateMany({
      where: { assignmentId: message.assignmentId, eventType: 'COLLECTED', status: 'PENDING' },
      data: { claimToken: replacement, claimedAt: NOW },
    });
  };
  try {
    await notices.drain(NOW);
  } finally {
    push.stealClaim = null;
  }
  const stolen = await prisma.v2OutboxEvent.findFirstOrThrow({
    where: { assignmentId: fenced.assignmentId, eventType: 'COLLECTED' },
  });
  expect(stolen.status).toBe('PENDING');
  expect(stolen.claimToken).toBe(replacement);
  expect(stolen.attemptCount).toBe(0);
  expect(stolen.sentAt).toBeNull();
  expect(push.messages).toHaveLength(1);
  await notices.drain(new Date(NOW.getTime() + v2NoticeConfig().leaseMs + 1));
  const recovered = await prisma.v2OutboxEvent.findFirstOrThrow({
    where: { assignmentId: fenced.assignmentId, eventType: 'COLLECTED' },
  });
  expect(recovered.status).toBe('SENT');
  expect(push.messages).toHaveLength(2);
  expect(await noticeEffects(fenced.deliveryId, fenced.assignmentId, fenced.walletId)).toEqual(fencedBefore);
}, 60_000);

it('stops after the configured number of genuine failures and ignores a missing provider', async () => {
  const hired = await hire();
  const parcel = await acceptJob(hired, '10.00');
  await step(hired.rider, parcel.deliveryId, DeliveryStatus.COLLECTED);
  await markAcceptedSent(parcel.assignmentId);
  await prisma.customerFcmDevice.deleteMany();
  await devices.register(customer, 'exhaust-token');
  await parkPendingExcept([parcel.assignmentId]);
  const before = await noticeEffects(parcel.deliveryId, parcel.assignmentId, hired.walletId);
  const previousMax = process.env.V2_NOTICE_MAX_ATTEMPTS;
  process.env.V2_NOTICE_MAX_ATTEMPTS = '2';
  push.outcome = 'temporary';
  push.messages.length = 0;
  try {
    await notices.drain(NOW);
    const once = await prisma.v2OutboxEvent.findFirstOrThrow({
      where: { assignmentId: parcel.assignmentId, eventType: 'COLLECTED' },
    });
    expect(once.status).toBe('PENDING');
    expect(once.attemptCount).toBe(1);
    expect(once.lastFailure).toBe('provider_unavailable');
    expect(once.failedAt).toBeNull();
    await notices.drain(new Date(NOW.getTime() + 2_000));
    const failed = await prisma.v2OutboxEvent.findFirstOrThrow({
      where: { assignmentId: parcel.assignmentId, eventType: 'COLLECTED' },
    });
    expect(failed.status).toBe('FAILED');
    expect(failed.attemptCount).toBe(2);
    expect(failed.failedAt?.getTime()).toBe(NOW.getTime() + 2_000);
    expect(failed.lastAttemptAt?.getTime()).toBe(NOW.getTime() + 2_000);
    expect(failed.lastFailure).toBe('provider_unavailable');
    expect(failed.claimedAt).toBeNull();
    expect(failed.nextAttemptAt).toBeNull();
    const sentCount = push.messages.length;
    expect(await notices.drain(new Date(NOW.getTime() + 60_000))).toBe(0);
    expect(push.messages).toHaveLength(sentCount);
  } finally {
    if (previousMax === undefined) delete process.env.V2_NOTICE_MAX_ATTEMPTS;
    else process.env.V2_NOTICE_MAX_ATTEMPTS = previousMax;
    push.outcome = 'accepted';
  }
  expect(await noticeEffects(parcel.deliveryId, parcel.assignmentId, hired.walletId)).toEqual(before);

  const quiet = await acceptJob(await hire(), '12.00');
  await step(quiet.rider, quiet.deliveryId, DeliveryStatus.COLLECTED);
  await markAcceptedSent(quiet.assignmentId);
  await parkPendingExcept([quiet.assignmentId]);
  push.ready = false;
  push.messages.length = 0;
  try {
    await notices.drain(NOW);
    const row = await prisma.v2OutboxEvent.findFirstOrThrow({
      where: { assignmentId: quiet.assignmentId, eventType: 'COLLECTED' },
    });
    expect(row.status).toBe('PENDING');
    expect(row.attemptCount).toBe(0);
    expect(row.lastFailure).toBeNull();
    expect(row.failedAt).toBeNull();
    expect(push.messages).toHaveLength(0);
    expect((await prisma.delivery.findUniqueOrThrow({ where: { id: quiet.deliveryId } })).status).toBe('COLLECTED');
  } finally {
    push.ready = true;
  }
}, 60_000);

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

async function waitForMessages(count: number) {
  const deadline = Date.now() + 5_000;
  while (push.messages.length < count) {
    if (Date.now() > deadline) {
      throw new Error('The provider call did not start');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function markAcceptedSent(assignmentId: string) {
  await prisma.v2OutboxEvent.updateMany({
    where: { assignmentId, eventType: 'BID_ACCEPTED' },
    data: { status: 'SENT', sentAt: NOW },
  });
}

async function lateParcel(
  hired: Hired,
  status: 'RIDER_ASSIGNED' | 'COLLECTING' | 'COLLECTED' | 'OUT_FOR_DELIVERY' | 'DELIVERED',
) {
  const opened = await acceptJob(hired, '10.00');
  if (status === 'COLLECTING') {
    await prisma.delivery.update({ where: { id: opened.deliveryId }, data: { status: 'COLLECTING' } });
  } else if (status === 'OUT_FOR_DELIVERY') {
    await step(hired.rider, opened.deliveryId, DeliveryStatus.COLLECTED);
    await prisma.delivery.update({ where: { id: opened.deliveryId }, data: { status: 'OUT_FOR_DELIVERY' } });
  } else if (status !== 'RIDER_ASSIGNED') {
    const chain = V2_STEPS.slice(0, V2_STEPS.indexOf(status) + 1);
    for (const stepStatus of chain) {
      await step(hired.rider, opened.deliveryId, stepStatus);
    }
  }
  await prisma.delivery.update({ where: { id: opened.deliveryId }, data: { deliverBy: LATE } });
  return { ...opened, status };
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

async function step(rider: { userId: string; riderProfileId: string }, deliveryId: string, status: DeliveryStatus) {
  progressSequence += 1;
  return dispatch.progress(rider, deliveryId, { status }, NOW, `step-${deliveryId}-${status}-${progressSequence}`);
}

async function parkPendingExcept(assignmentIds: string[]) {
  await prisma.v2OutboxEvent.updateMany({
    where: {
      status: 'PENDING',
      assignmentId: { notIn: assignmentIds },
    },
    data: { nextAttemptAt: new Date('2099-01-01T00:00:00.000Z') },
  });
}

async function feeCount(assignmentId: string) {
  return prisma.riderWalletEntry.count({ where: { idempotencyKey: `platform-fee:assignment:${assignmentId}` } });
}

async function acceptJob(hired: Hired, amount: string) {
  const delivery = await prisma.delivery.create({ data: deliveryData() });
  const bid = await prisma.bid.create({
    data: { deliveryId: delivery.id, riderProfileId: hired.riderProfileId, amount, currency: 'USD', status: 'OPEN' },
  });
  const accepted = await acceptance.accept(customer, delivery.id, bid.id, `accept-${delivery.id}`, NOW);
  return {
    rider: hired.rider,
    walletId: hired.walletId,
    deliveryId: delivery.id,
    assignmentId: accepted.assignmentId,
    bidId: bid.id,
    acceptKey: `accept-${delivery.id}`,
  };
}

function deliveryData() {
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
    serviceClass: 'FLEXIBLE' as const,
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
      await delay(500);
    }
  }
  throw lastError;
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
