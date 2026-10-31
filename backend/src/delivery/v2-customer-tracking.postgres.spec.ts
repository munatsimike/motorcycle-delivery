import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { ForbiddenException } from '@nestjs/common';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DeliveryStatus, UserRole } from '../generated/prisma/client.js';
import { AccessTokenService } from '../auth/access-token.service.js';
import { CustomerAccessGuard } from '../auth/customer-access.guard.js';
import { CustomerAccessService } from '../auth/customer-access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BidAcceptanceService } from './bid-acceptance.service.js';
import { DeliveryService } from './delivery.service.js';
import { DispatchService } from './dispatch.service.js';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const PRISMA_CLI = require.resolve('prisma/build/index.js');
const HOST = '127.0.0.1';
const PORT = 54352;
const DATABASE = 'tracking_m5b';
const CONTAINER = 'riders-m5b-tracking-pg';
const DISPOSABLE_URL = `postgresql://postgres:postgres@${HOST}:${PORT}/${DATABASE}`;
const NOW = new Date('2026-10-24T08:00:00.000Z');
const DEADLINE = new Date('2026-10-24T18:00:00.000Z');
const RIDER_LATITUDE = '-17.8012345';
const RIDER_LONGITUDE = '31.1098765';
const MOVED_LATITUDE = '-17.8111111';
const MOVED_LONGITUDE = '31.1191111';
const HIDDEN_ADDRESS = 'Hidden Parcel Road';
const HIDDEN_PHONE = '+263771009009';
const HIDDEN_RECIPIENT = 'Hidden Recipient';

let prisma: PrismaService;
let acceptance: BidAcceptanceService;
let dispatch: DispatchService;
let deliveries: DeliveryService;
let customer: { userId: string; role: typeof UserRole.CUSTOMER; customerAccountId: string };
let otherCustomer: { userId: string; role: typeof UserRole.CUSTOMER; customerAccountId: string };
let adminId = '';
let phone = 791000100;
let registration = 6000;
let progressSequence = 0;
const previousDatabaseUrl = process.env.DATABASE_URL;
const previousFlag = process.env.V2_MARKETPLACE_ENABLED;
const previousSsl = process.env.DATABASE_SSL_CA;
const previousSecret = process.env.JWT_ACCESS_SECRET;

beforeAll(async () => {
  const parsed = new URL(DISPOSABLE_URL);
  if (parsed.hostname !== HOST || parsed.port !== String(PORT) || parsed.pathname !== `/${DATABASE}`) {
    throw new Error('Refusing to use a database that is not the disposable local tracking test database');
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
  } finally {
    await observer.end().catch(() => undefined);
  }
  prisma = new PrismaService();
  await prisma.$connect();
  acceptance = new BidAcceptanceService(prisma);
  dispatch = new DispatchService(prisma);
  deliveries = new DeliveryService(prisma);
  const admin = await prisma.user.create({
    data: { fullName: 'Admin', phone: nextPhone(), role: UserRole.ADMIN, accountStatus: 'ACTIVE', phoneVerifiedAt: NOW },
  });
  adminId = admin.id;
  customer = await customerAccount('Owner');
  otherCustomer = await customerAccount('Other');
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
  if (previousSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
  else process.env.JWT_ACCESS_SECRET = previousSecret;
}, 60_000);

it('shows the current rider point only while that parcel is collecting', async () => {
  const hired = await hire();
  const opened = await acceptJob(hired, customer);
  const hidden = await acceptJob(hired, otherCustomer, {
    pickupAddress: HIDDEN_ADDRESS,
    recipientName: HIDDEN_RECIPIENT,
    recipientPhone: HIDDEN_PHONE,
  });
  await expect(read(opened.deliveryId)).resolves.not.toHaveProperty('riderLocation');

  await prisma.delivery.update({ where: { id: opened.deliveryId }, data: { status: 'COLLECTING' } });
  const beforePoint = await read(opened.deliveryId);
  expect(beforePoint.status).toBe('COLLECTING');
  expect(beforePoint).not.toHaveProperty('riderLocation');

  await storePoint(hired.riderProfileId, RIDER_LATITUDE, RIDER_LONGITUDE);
  const collecting = await read(opened.deliveryId);
  expect(riderPoint(collecting)).toMatchObject({ latitude: RIDER_LATITUDE, longitude: RIDER_LONGITUDE });
  expect(JSON.stringify(collecting)).not.toContain(HIDDEN_ADDRESS);
  expect(JSON.stringify(collecting)).not.toContain(HIDDEN_PHONE);
  expect(JSON.stringify(collecting)).not.toContain(HIDDEN_RECIPIENT);
  expect(JSON.stringify(collecting)).not.toContain(hidden.assignmentId);
  expect(collecting).not.toHaveProperty('assignmentId');

  await storePoint(hired.riderProfileId, MOVED_LATITUDE, MOVED_LONGITUDE);
  expect(riderPoint(await read(opened.deliveryId))).toMatchObject({
    latitude: MOVED_LATITUDE,
    longitude: MOVED_LONGITUDE,
  });

  await step(hired.rider, opened.deliveryId, DeliveryStatus.COLLECTED);
  const collected = await read(opened.deliveryId);
  expect(collected).not.toHaveProperty('riderLocation');
  expect(JSON.stringify(collected)).not.toContain(MOVED_LATITUDE);

  await prisma.delivery.update({ where: { id: opened.deliveryId }, data: { status: 'OUT_FOR_DELIVERY' } });
  expect(await read(opened.deliveryId)).not.toHaveProperty('riderLocation');
  await step(hired.rider, opened.deliveryId, DeliveryStatus.DELIVERED);
  expect(await read(opened.deliveryId)).not.toHaveProperty('riderLocation');
  expect(JSON.stringify(await read(opened.deliveryId))).not.toContain(MOVED_LATITUDE);

  const listed = await deliveries.list(customer, {});
  expect(JSON.stringify(listed)).not.toContain(MOVED_LATITUDE);
  expect(JSON.stringify(listed)).not.toContain('riderLocation');
});

it('keeps location visibility independent for two Flexible parcels', async () => {
  const hired = await hire();
  await storePoint(hired.riderProfileId, RIDER_LATITUDE, RIDER_LONGITUDE);
  const first = await acceptJob(hired, customer);
  const second = await acceptJob(hired, customer, { pickupAddress: 'Second Pickup Road', recipientName: 'Second Recipient' });
  await prisma.delivery.update({ where: { id: first.deliveryId }, data: { status: 'COLLECTING' } });
  const visible = await read(first.deliveryId);
  const waiting = await read(second.deliveryId);
  expect(riderPoint(visible)).toMatchObject({ latitude: RIDER_LATITUDE, longitude: RIDER_LONGITUDE });
  expect(waiting.status).toBe('RIDER_ASSIGNED');
  expect(riderPoint(waiting)).toMatchObject({ latitude: RIDER_LATITUDE, longitude: RIDER_LONGITUDE });
  expect(JSON.stringify(visible)).not.toContain('Second Pickup Road');
  expect(JSON.stringify(visible)).not.toContain('Second Recipient');

  await step(hired.rider, first.deliveryId, DeliveryStatus.COLLECTED);
  await prisma.delivery.update({ where: { id: second.deliveryId }, data: { status: 'COLLECTING' } });
  expect(await read(first.deliveryId)).not.toHaveProperty('riderLocation');
  expect(riderPoint(await read(second.deliveryId))).toMatchObject({
    latitude: RIDER_LATITUDE,
    longitude: RIDER_LONGITUDE,
  });
});

it('omits the rider point after cancellation and refuses other customers and rider tokens', async () => {
  const hired = await hire();
  await storePoint(hired.riderProfileId, RIDER_LATITUDE, RIDER_LONGITUDE);
  const opened = await acceptJob(hired, customer);
  await prisma.delivery.update({ where: { id: opened.deliveryId }, data: { status: 'COLLECTING' } });
  expect(riderPoint(await read(opened.deliveryId)).latitude).toBe(RIDER_LATITUDE);

  await dispatch.cancel(customer, opened.deliveryId, NOW);
  const cancelled = await read(opened.deliveryId);
  expect(cancelled.status).toBe('CANCELLED');
  expect(cancelled).not.toHaveProperty('riderLocation');
  expect(JSON.stringify(cancelled)).not.toContain(RIDER_LATITUDE);

  await expect(deliveries.getById(otherCustomer, opened.deliveryId)).rejects.toThrow('Delivery not found');
  await expect(deliveries.getById(
    { userId: hired.rider.userId, role: UserRole.RIDER, customerAccountId: customer.customerAccountId },
    opened.deliveryId,
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
  const request = { headers: { authorization: header } };
  await expect(guard.canActivate({
    switchToHttp: () => ({ getRequest: () => request }),
  } as never)).rejects.toThrow('Customer access is required');
});

it('leaves a V1 customer delivery without a rider point', async () => {
  const hired = await hire();
  await storePoint(hired.riderProfileId, RIDER_LATITUDE, RIDER_LONGITUDE);
  await prisma.riderLocation.update({
    where: { riderProfileId: hired.riderProfileId },
    data: { updatedAt: NOW },
  });
  const delivery = await prisma.delivery.create({
    data: {
      customerId: customer.customerAccountId,
      pickupAddress: 'V1 Pickup Road',
      pickupLatitude: '-17.1000000',
      pickupLongitude: '31.1000000',
      pickupCoordinateSource: 'DEVICE_GEOCODER',
      pickupContactName: 'Sender',
      pickupContactPhone: '+263770000001',
      dropoffAddress: 'V1 Dropoff Road',
      dropoffLatitude: '-17.2000000',
      dropoffLongitude: '31.2000000',
      dropoffCoordinateSource: 'DEVICE_GEOCODER',
      parcelDescription: 'Parcel',
      parcelSize: 'SMALL',
      recipientName: 'V1 Recipient',
      recipientPhone: '+263770000002',
      suggestedPrice: '6.00',
      price: '6.00',
      payer: 'SENDER',
      paymentMethod: 'CASH',
      distanceMeters: 1_000,
      pricingVersion: 1,
      currency: 'USD',
      status: 'ASSIGNED',
      searchGeneration: 1,
    },
  });
  await prisma.deliveryAssignment.create({
    data: {
      deliveryId: delivery.id,
      riderProfileId: hired.riderProfileId,
      motorcycleId: hired.motorcycleId,
      status: 'ACCEPTED',
      offerExpiresAt: new Date(NOW.getTime() + 60_000),
      respondedAt: NOW,
      acceptedPlatformFee: '1.50',
      acceptedFeeConfigVersion: 1,
      acceptedCommissionModel: 'ON_COMPLETION',
      acceptedCommissionPolicyVersion: 1,
    },
  });
  const assigned = await read(delivery.id);
  expect(assigned.status).toBe('ASSIGNED');
  expect(assigned.pickup.address).toBe('V1 Pickup Road');
  expect(assigned.pickup.latitude).toBe('-17.1000000');
  expect(assigned).not.toHaveProperty('riderLocation');
  expect(JSON.stringify(assigned)).not.toContain(RIDER_LATITUDE);

  await prisma.delivery.update({ where: { id: delivery.id }, data: { status: 'ARRIVED_AT_PICKUP' } });
  const arrived = await read(delivery.id);
  expect(arrived.status).toBe('ARRIVED_AT_PICKUP');
  expect(arrived).not.toHaveProperty('riderLocation');
  expect(JSON.stringify(arrived)).not.toContain(RIDER_LATITUDE);
});

async function read(deliveryId: string) {
  return deliveries.getById(customer, deliveryId);
}

function riderPoint(view: object): { latitude: string; longitude: string } {
  if (!('riderLocation' in view)) {
    throw new Error('rider location missing');
  }
  const point = view.riderLocation;
  if (
    point === null
    || typeof point !== 'object'
    || !('latitude' in point)
    || !('longitude' in point)
    || typeof point.latitude !== 'string'
    || typeof point.longitude !== 'string'
  ) {
    throw new Error('rider location missing');
  }
  return { latitude: point.latitude, longitude: point.longitude };
}

async function step(
  rider: { userId: string; riderProfileId: string },
  deliveryId: string,
  status: DeliveryStatus,
) {
  progressSequence += 1;
  return dispatch.progress(rider, deliveryId, { status }, NOW, `track-${deliveryId}-${status}-${progressSequence}`);
}

async function storePoint(riderProfileId: string, latitude: string, longitude: string) {
  await prisma.riderLocation.upsert({
    where: { riderProfileId },
    create: { riderProfileId, latitude, longitude, updatedAt: new Date() },
    update: { latitude, longitude, updatedAt: new Date() },
  });
}

async function acceptJob(
  hired: Hired,
  owner: { userId: string; role: typeof UserRole.CUSTOMER; customerAccountId: string },
  extra: { pickupAddress?: string; recipientName?: string; recipientPhone?: string } = {},
) {
  const delivery = await prisma.delivery.create({
    data: {
      customerId: owner.customerAccountId,
      pickupAddress: extra.pickupAddress ?? 'Pickup road',
      pickupCoordinateSource: 'UNREVIEWED',
      pickupContactName: 'Sender',
      pickupContactPhone: '+263770000001',
      dropoffAddress: 'Dropoff road',
      dropoffCoordinateSource: 'UNREVIEWED',
      parcelDescription: 'Documents',
      parcelSize: 'SMALL',
      recipientName: extra.recipientName ?? 'Recipient',
      recipientPhone: extra.recipientPhone ?? '+263770000002',
      suggestedPrice: '9.00',
      distanceMeters: 1_000,
      pricingVersion: 1,
      currency: 'USD',
      serviceClass: 'FLEXIBLE',
      deliverBy: DEADLINE,
      status: 'CREATED',
      searchGeneration: 0,
    },
  });
  const bid = await prisma.bid.create({
    data: { deliveryId: delivery.id, riderProfileId: hired.riderProfileId, amount: '10.00', currency: 'USD', status: 'OPEN' },
  });
  const accepted = await acceptance.accept(owner, delivery.id, bid.id, `accept-${delivery.id}`, NOW);
  return { deliveryId: delivery.id, assignmentId: accepted.assignmentId };
}

type Hired = {
  rider: { userId: string; riderProfileId: string };
  riderProfileId: string;
  motorcycleId: string;
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
  await prisma.riderWallet.create({
    data: { riderProfileId: profile.id, currency: 'USD', balance: '0.00', borrowingLimitOverride: '50.00' },
  });
  return {
    rider: { userId: user.id, riderProfileId: profile.id },
    riderProfileId: profile.id,
    motorcycleId: motorcycle.id,
  };
}

async function customerAccount(name: string) {
  const user = await prisma.user.create({
    data: { fullName: name, phone: nextPhone(), role: UserRole.CUSTOMER, accountStatus: 'ACTIVE', phoneVerifiedAt: NOW },
  });
  const account = await prisma.customerAccount.create({
    data: { userId: user.id, kind: 'INDIVIDUAL', name, address: 'Harare' },
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
