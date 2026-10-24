import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';

const exec = promisify(execFile);
const HOST = '127.0.0.1';
const PORT = 54344;
const DATABASE = 'acceptance_m3';
const CONTAINER = 'riders-m3-acceptance-pg';
const DISPOSABLE_URL = `postgresql://postgres:postgres@${HOST}:${PORT}/${DATABASE}`;
const ADMIN = '00000000-0000-7000-8000-0000000000a1';
const RIDER_A = '00000000-0000-7000-8000-0000000000a2';
const RIDER_B = '00000000-0000-7000-8000-0000000000b2';
const RIDER_C = '00000000-0000-7000-8000-0000000000c2';
const DELIVERY_A = '00000000-0000-7000-8000-0000000000d1';
const DELIVERY_B = '00000000-0000-7000-8000-0000000000d2';
const DELIVERY_C = '00000000-0000-7000-8000-0000000000d3';
const DELIVERY_D = '00000000-0000-7000-8000-0000000000d4';
const DELIVERY_E = '00000000-0000-7000-8000-0000000000d5';
const WALLET = '00000000-0000-7000-8000-0000000000e1';

let observer: pg.Client;
let other: pg.Client;

beforeAll(async () => {
  const parsed = new URL(DISPOSABLE_URL);
  if (parsed.hostname !== HOST || parsed.port !== String(PORT) || parsed.pathname !== `/${DATABASE}`) {
    throw new Error('Refusing to use a database that is not the disposable local acceptance test database');
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
  observer = await waitForPostgres();
  const hosted = await observer.query("SELECT nspname FROM pg_namespace WHERE nspname IN ('auth', 'storage', 'supabase_migrations')");
  if (hosted.rows.length > 0) {
    throw new Error('Refusing a database that already contains hosted Supabase schemas');
  }
  await observer.query(`
    CREATE TYPE "service_class" AS ENUM ('EXPRESS', 'FLEXIBLE');
    CREATE TYPE "delivery_status" AS ENUM ('CREATED', 'ASSIGNED');
    CREATE TYPE "assignment_status" AS ENUM ('OFFERED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'ACCEPTED', 'RELEASED', 'COMPLETED', 'FAILED');
    CREATE TYPE "currency" AS ENUM ('USD');
    CREATE TYPE "bid_status" AS ENUM ('OPEN', 'WITHDRAWN', 'ACCEPTED', 'SUPERSEDED', 'EXPIRED');
    CREATE TYPE "wallet_fee_reservation_status" AS ENUM ('OPEN', 'RELEASED', 'CAPTURED');
    CREATE TABLE "users" ("id" UUID PRIMARY KEY);
    CREATE TABLE "rider_profiles" ("id" UUID PRIMARY KEY);
    CREATE TABLE "deliveries" ("id" UUID PRIMARY KEY);
    CREATE TABLE "delivery_assignments" (
      "id" UUID PRIMARY KEY,
      "delivery_id" UUID NOT NULL REFERENCES "deliveries"("id"),
      "rider_profile_id" UUID NOT NULL REFERENCES "rider_profiles"("id"),
      "status" "assignment_status" NOT NULL,
      "offer_expires_at" TIMESTAMPTZ(6) NOT NULL,
      "accepted_platform_fee" DECIMAL(12,2),
      "accepted_fee_config_version" INTEGER
    )
  `);
  await applySql(observer, 'prisma/migrations/20261024100000_v2_commission_rates/migration.sql');
  await applySql(observer, 'prisma/migrations/20261024110000_v2_commission_snapshots/migration.sql');
  await observer.query(`
    ALTER TABLE "delivery_assignments"
      ADD CONSTRAINT "delivery_assignments_accepted_fee_chk"
      CHECK (
        (
          "status" IN ('OFFERED', 'REJECTED', 'EXPIRED', 'CANCELLED')
          AND "accepted_platform_fee" IS NULL
          AND "accepted_fee_config_version" IS NULL
        )
        OR (
          "status" IN ('ACCEPTED', 'RELEASED', 'COMPLETED', 'FAILED')
          AND "accepted_platform_fee" IS NOT NULL
          AND "accepted_platform_fee" >= 0
          AND "accepted_fee_config_version" IS NOT NULL
          AND "accepted_fee_config_version" >= 1
        )
      );
    CREATE UNIQUE INDEX "delivery_assignments_one_accepted_per_rider_idx"
      ON "delivery_assignments" ("rider_profile_id") WHERE "status" = 'ACCEPTED';
    CREATE UNIQUE INDEX "delivery_assignments_one_accepted_per_delivery_idx"
      ON "delivery_assignments" ("delivery_id") WHERE "status" = 'ACCEPTED';
    CREATE TABLE "bids" (
      "id" UUID PRIMARY KEY,
      "delivery_id" UUID NOT NULL REFERENCES "deliveries"("id"),
      "rider_profile_id" UUID NOT NULL REFERENCES "rider_profiles"("id"),
      "amount" DECIMAL(12,2) NOT NULL,
      "status" "bid_status" NOT NULL
    );
    CREATE UNIQUE INDEX "bids_one_accepted_per_delivery_idx"
      ON "bids" ("delivery_id") WHERE "status" = 'ACCEPTED';
    CREATE TABLE "rider_wallets" ("id" UUID PRIMARY KEY);
    CREATE TABLE "wallet_fee_reservations" (
      "id" UUID PRIMARY KEY,
      "rider_wallet_id" UUID NOT NULL REFERENCES "rider_wallets"("id"),
      "delivery_id" UUID REFERENCES "deliveries"("id"),
      "assignment_id" UUID UNIQUE,
      "amount" DECIMAL(12,2) NOT NULL,
      "currency" "currency" NOT NULL,
      "config_version" INTEGER NOT NULL,
      "status" "wallet_fee_reservation_status" NOT NULL,
      "released_at" TIMESTAMPTZ(6),
      "captured_at" TIMESTAMPTZ(6)
    );
    CREATE UNIQUE INDEX "wallet_fee_reservations_one_open_per_delivery_idx"
      ON "wallet_fee_reservations" ("delivery_id")
      WHERE "status" = 'OPEN' AND "delivery_id" IS NOT NULL;
    ALTER TABLE "wallet_fee_reservations"
      ADD CONSTRAINT "wallet_fee_reservations_status_chk"
      CHECK (
        "amount" > 0
        AND "currency" = 'USD'
        AND "config_version" >= 1
        AND "status" = 'OPEN'
        AND "released_at" IS NULL
        AND "captured_at" IS NULL
      )
  `);
  await applySql(observer, 'prisma/migrations/20261024130000_v2_bid_acceptance/migration.sql');
  await observer.query('INSERT INTO "users" ("id") VALUES ($1)', [ADMIN]);
  await observer.query(
    `INSERT INTO v2_commission_rates (id, rate_version, basis_points, is_active, created_by_id)
     VALUES (gen_random_uuid(), 4, 1000, true, $1)`,
    [ADMIN],
  );
  await observer.query('INSERT INTO "rider_profiles" ("id") VALUES ($1), ($2), ($3)', [RIDER_A, RIDER_B, RIDER_C]);
  await observer.query('INSERT INTO "deliveries" ("id") VALUES ($1), ($2), ($3), ($4), ($5)', [DELIVERY_A, DELIVERY_B, DELIVERY_C, DELIVERY_D, DELIVERY_E]);
  await observer.query('INSERT INTO "rider_wallets" ("id") VALUES ($1)', [WALLET]);
  other = new pg.Client({ connectionString: DISPOSABLE_URL });
  await other.connect();
}, 180_000);

afterAll(async () => {
  await observer?.end().catch(() => undefined);
  await other?.end().catch(() => undefined);
  await exec('docker', ['rm', '-f', CONTAINER], { windowsHide: true }).catch(() => undefined);
}, 60_000);

it('stores a V2 accepted assignment with a null platform fee and keeps the snapshot', async () => {
  const statuses = await observer.query("SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_type.oid = enumtypid WHERE typname = 'delivery_status'");
  expect(statuses.rows.map((row) => row.enumlabel)).toContain('RIDER_ASSIGNED');
  const indexes = await observer.query("SELECT indexname FROM pg_indexes WHERE indexname = 'delivery_assignments_one_accepted_per_rider_idx'");
  expect(indexes.rows).toHaveLength(1);
  const express = await observer.query("SELECT indexname FROM pg_indexes WHERE indexname LIKE '%live_express%'");
  expect(express.rows).toHaveLength(0);

  await observer.query(
    `INSERT INTO delivery_assignments (
       id, delivery_id, rider_profile_id, status, offer_expires_at, service_class,
       accepted_bid_amount, accepted_commission_basis_points, accepted_v2_commission_rate_version, accepted_commission_amount
     ) VALUES ($1, $2, $3, 'ACCEPTED', NOW(), 'EXPRESS', 10.00, 1000, 4, 1.00)`,
    ['00000000-0000-7000-8000-000000000011', DELIVERY_A, RIDER_A],
  );
  await expect(observer.query(
    `INSERT INTO delivery_assignments (
       id, delivery_id, rider_profile_id, status, offer_expires_at,
       accepted_platform_fee, accepted_fee_config_version
     ) VALUES ($1, $2, $3, 'ACCEPTED', NOW(), 1.50, 2)`,
    ['00000000-0000-7000-8000-000000000012', DELIVERY_B, RIDER_B],
  )).resolves.toBeTruthy();
  await expect(observer.query(
    `INSERT INTO delivery_assignments (id, delivery_id, rider_profile_id, status, offer_expires_at)
     VALUES ($1, $2, $3, 'ACCEPTED', NOW())`,
    ['00000000-0000-7000-8000-000000000013', DELIVERY_A, RIDER_B],
  )).rejects.toMatchObject({ code: '23514', constraint: 'delivery_assignments_accepted_fee_chk' });
  await expect(observer.query(
    'UPDATE delivery_assignments SET accepted_commission_amount = 2.00 WHERE id = $1',
    ['00000000-0000-7000-8000-000000000011'],
  )).rejects.toMatchObject({ code: 'P0001' });
  await observer.query('UPDATE v2_commission_rates SET basis_points = 2500 WHERE rate_version = 4');
  const snapshot = await observer.query(
    'SELECT accepted_commission_basis_points, accepted_commission_amount, accepted_platform_fee FROM delivery_assignments WHERE id = $1',
    ['00000000-0000-7000-8000-000000000011'],
  );
  expect(snapshot.rows[0]).toMatchObject({
    accepted_commission_basis_points: 1000,
    accepted_commission_amount: '1.00',
    accepted_platform_fee: null,
  });
});

it('rejects a second accepted assignment, a second accepted bid, a zero reservation, and a second open reservation', async () => {
  await expect(observer.query(
    `INSERT INTO delivery_assignments (
       id, delivery_id, rider_profile_id, status, offer_expires_at, service_class,
       accepted_bid_amount, accepted_commission_basis_points, accepted_v2_commission_rate_version, accepted_commission_amount
     ) VALUES ($1, $2, $3, 'ACCEPTED', NOW(), 'FLEXIBLE', 8.00, 1000, 4, 0.80)`,
    ['00000000-0000-7000-8000-000000000021', DELIVERY_E, RIDER_A],
  )).rejects.toMatchObject({ code: '23505', constraint: 'delivery_assignments_one_accepted_per_rider_idx' });

  await observer.query(
    `INSERT INTO bids (id, delivery_id, rider_profile_id, amount, status) VALUES ($1, $2, $3, 10.00, 'ACCEPTED')`,
    ['00000000-0000-7000-8000-0000000000c1', DELIVERY_A, RIDER_A],
  );
  await expect(observer.query(
    `INSERT INTO bids (id, delivery_id, rider_profile_id, amount, status) VALUES ($1, $2, $3, 8.00, 'ACCEPTED')`,
    ['00000000-0000-7000-8000-0000000000c2', DELIVERY_A, RIDER_B],
  )).rejects.toMatchObject({ code: '23505', constraint: 'bids_one_accepted_per_delivery_idx' });

  await expect(observer.query(
    `INSERT INTO wallet_fee_reservations (id, rider_wallet_id, delivery_id, assignment_id, amount, currency, config_version, status)
     VALUES ($1, $2, $3, $4, 0.00, 'USD', 4, 'OPEN')`,
    ['00000000-0000-7000-8000-0000000000f0', WALLET, DELIVERY_A, '00000000-0000-7000-8000-000000000011'],
  )).rejects.toMatchObject({ code: '23514', constraint: 'wallet_fee_reservations_status_chk' });

  const first = observer.query(
    `INSERT INTO wallet_fee_reservations (id, rider_wallet_id, delivery_id, assignment_id, amount, currency, config_version, status)
     VALUES ($1, $2, $3, $4, 1.00, 'USD', 4, 'OPEN')`,
    ['00000000-0000-7000-8000-0000000000f1', WALLET, DELIVERY_A, '00000000-0000-7000-8000-000000000011'],
  );
  const second = other.query(
    `INSERT INTO wallet_fee_reservations (id, rider_wallet_id, delivery_id, assignment_id, amount, currency, config_version, status)
     VALUES ($1, $2, $3, $4, 1.00, 'USD', 4, 'OPEN')`,
    ['00000000-0000-7000-8000-0000000000f2', WALLET, DELIVERY_A, '00000000-0000-7000-8000-000000000099'],
  );
  const results = await Promise.allSettled([first, second]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((result) => result.status === 'rejected');
  expect(rejected?.status === 'rejected' ? rejected.reason : null).toMatchObject({
    code: '23505',
    constraint: 'wallet_fee_reservations_one_open_per_delivery_idx',
  });
  const stored = await observer.query("SELECT count(*)::int AS count FROM wallet_fee_reservations WHERE status = 'OPEN'");
  expect(stored.rows[0]?.count).toBe(1);
});

it('lets one of two concurrent accepted inserts win for the same rider', async () => {
  const first = observer.query(
    `INSERT INTO delivery_assignments (
       id, delivery_id, rider_profile_id, status, offer_expires_at, service_class,
       accepted_bid_amount, accepted_commission_basis_points, accepted_v2_commission_rate_version, accepted_commission_amount
     ) VALUES ($1, $2, $3, 'ACCEPTED', NOW(), 'FLEXIBLE', 5.00, 1000, 4, 0.50)`,
    ['00000000-0000-7000-8000-000000000031', DELIVERY_C, RIDER_C],
  );
  const second = other.query(
    `INSERT INTO delivery_assignments (
       id, delivery_id, rider_profile_id, status, offer_expires_at, service_class,
       accepted_bid_amount, accepted_commission_basis_points, accepted_v2_commission_rate_version, accepted_commission_amount
     ) VALUES ($1, $2, $3, 'ACCEPTED', NOW(), 'FLEXIBLE', 6.00, 1000, 4, 0.60)`,
    ['00000000-0000-7000-8000-000000000032', DELIVERY_D, RIDER_C],
  );
  const results = await Promise.allSettled([first, second]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((result) => result.status === 'rejected');
  expect(rejected?.status === 'rejected' ? rejected.reason : null).toMatchObject({
    code: '23505',
    constraint: 'delivery_assignments_one_accepted_per_rider_idx',
  });
  const rows = await observer.query("SELECT count(*)::int AS count FROM delivery_assignments WHERE rider_profile_id = $1 AND status = 'ACCEPTED'", [RIDER_C]);
  expect(rows.rows[0]?.count).toBe(1);
});

async function applySql(client: pg.Client, path: string) {
  for (const statement of sqlStatements(readFileSync(path, 'utf8'))) {
    await client.query(statement);
  }
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
