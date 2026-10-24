import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';

const exec = promisify(execFile);
const HOST = '127.0.0.1';
const PORT = 54343;
const DATABASE = 'bids_m2a';
const CONTAINER = 'riders-m2a-bid-pg';
const DISPOSABLE_URL = `postgresql://postgres:postgres@${HOST}:${PORT}/${DATABASE}`;
const DELIVERY = '00000000-0000-7000-8000-0000000000d1';
const RIDER_A = '00000000-0000-7000-8000-0000000000a1';
const RIDER_B = '00000000-0000-7000-8000-0000000000b1';

let observer: pg.Client;
let other: pg.Client;

beforeAll(async () => {
  const parsed = new URL(DISPOSABLE_URL);
  if (parsed.hostname !== HOST || parsed.port !== String(PORT) || parsed.pathname !== `/${DATABASE}`) {
    throw new Error('Refusing to use a database that is not the disposable local bid test database');
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
    CREATE TYPE "currency" AS ENUM ('USD');
    CREATE TYPE "delivery_payer" AS ENUM ('SENDER', 'RECIPIENT');
    CREATE TYPE "payment_method" AS ENUM ('CASH');
    CREATE TYPE "pricing_model" AS ENUM ('FIXED', 'PER_KILOMETRE', 'BASE_PLUS_PER_KILOMETRE', 'DISTANCE_TIERS');
    CREATE TYPE "bid_status" AS ENUM ('OPEN', 'WITHDRAWN', 'ACCEPTED', 'SUPERSEDED', 'EXPIRED');
    CREATE TABLE "pricing_windows" ("id" UUID PRIMARY KEY);
    CREATE TABLE "deliveries" (
      "id" UUID PRIMARY KEY,
      "price" DECIMAL(12,2) NOT NULL,
      "payer" "delivery_payer" NOT NULL,
      "payment_method" "payment_method" NOT NULL
    );
    CREATE TABLE "rider_profiles" ("id" UUID PRIMARY KEY);
    CREATE TABLE "bids" (
      "id" UUID PRIMARY KEY,
      "delivery_id" UUID NOT NULL REFERENCES "deliveries"("id"),
      "rider_profile_id" UUID NOT NULL REFERENCES "rider_profiles"("id"),
      "amount" DECIMAL(12,2) NOT NULL,
      "currency" "currency" NOT NULL DEFAULT 'USD',
      "status" "bid_status" NOT NULL,
      "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX "bids_one_open_per_rider_delivery_idx"
      ON "bids" ("delivery_id", "rider_profile_id") WHERE "status" = 'OPEN';
    CREATE UNIQUE INDEX "bids_one_accepted_per_delivery_idx"
      ON "bids" ("delivery_id") WHERE "status" = 'ACCEPTED'
  `);
  await applySql(observer, 'prisma/migrations/20261024120000_v2_bid_lifecycle/migration.sql');
  await observer.query('INSERT INTO "rider_profiles" ("id") VALUES ($1), ($2)', [RIDER_A, RIDER_B]);
  await observer.query('INSERT INTO "deliveries" ("id", "price", "payer", "payment_method") VALUES ($1, NULL, NULL, NULL)', [DELIVERY]);
  other = new pg.Client({ connectionString: DISPOSABLE_URL });
  await other.connect();
}, 180_000);

afterAll(async () => {
  await observer?.end().catch(() => undefined);
  await other?.end().catch(() => undefined);
  await exec('docker', ['rm', '-f', CONTAINER], { windowsHide: true }).catch(() => undefined);
}, 60_000);

it('allows a delivery with no agreed price and keeps one open bid per rider', async () => {
  const first = observer.query(
    `INSERT INTO "bids" ("id", "delivery_id", "rider_profile_id", "amount", "status", "idempotency_key", "payload_hash")
     VALUES ($1, $2, $3, 10.00, 'OPEN', 'key-a', $4)`,
    ['00000000-0000-7000-8000-0000000000c1', DELIVERY, RIDER_A, 'a'.repeat(64)],
  );
  const second = other.query(
    `INSERT INTO "bids" ("id", "delivery_id", "rider_profile_id", "amount", "status", "idempotency_key", "payload_hash")
     VALUES ($1, $2, $3, 11.00, 'OPEN', 'key-b', $4)`,
    ['00000000-0000-7000-8000-0000000000c2', DELIVERY, RIDER_A, 'b'.repeat(64)],
  );
  const results = await Promise.allSettled([first, second]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((result) => result.status === 'rejected');
  expect(rejected?.status === 'rejected' ? rejected.reason : null).toMatchObject({
    code: '23505',
    constraint: 'bids_one_open_per_rider_delivery_idx',
  });
  await observer.query('ROLLBACK').catch(() => undefined);
  await other.query('ROLLBACK').catch(() => undefined);
  const stored = await observer.query("SELECT status FROM bids WHERE rider_profile_id = $1", [RIDER_A]);
  expect(stored.rows).toHaveLength(1);
  expect(stored.rows[0]?.status).toBe('OPEN');
});

it('expires a bid by status and keeps the historical row', async () => {
  const open = await observer.query("SELECT id FROM bids WHERE status = 'OPEN' LIMIT 1");
  await observer.query(`UPDATE bids SET status = 'EXPIRED' WHERE id = $1`, [open.rows[0].id]);
  const kept = await observer.query('SELECT id, status FROM bids WHERE id = $1', [open.rows[0].id]);
  expect(kept.rows).toEqual([{ id: open.rows[0].id, status: 'EXPIRED' }]);
  await observer.query(
    `INSERT INTO bids (id, delivery_id, rider_profile_id, amount, status, idempotency_key, payload_hash)
     VALUES ($1, $2, $3, 8.00, 'OPEN', 'key-c', $4)`,
    ['00000000-0000-7000-8000-0000000000c3', DELIVERY, RIDER_B, 'c'.repeat(64)],
  );
  const rows = await observer.query('SELECT status FROM bids ORDER BY amount');
  expect(rows.rows.map((row) => row.status).sort()).toEqual(['EXPIRED', 'OPEN']);
});

async function waitForPostgres(): Promise<pg.Client> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < 60_000) {
    const client = new pg.Client({ connectionString: DISPOSABLE_URL });
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
  throw lastError instanceof Error ? lastError : new Error('PostgreSQL did not start');
}

async function applySql(client: pg.Client, path: string) {
  const sql = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  for (const statement of sql.split(';').map((part) => part.trim()).filter((part) => part.length > 0)) {
    await client.query(statement);
  }
}
