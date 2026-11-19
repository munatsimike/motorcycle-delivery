import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';

const exec = promisify(execFile);
const HOST = '127.0.0.1';
const PORT = 54373;
const DATABASE = 'address_book';
const CONTAINER = 'riders-address-book-pg';
const DISPOSABLE_URL = `postgresql://postgres:postgres@${HOST}:${PORT}/${DATABASE}`;
const OWNER = '018f5b4a-7c3a-7c3a-8c3a-000000000001';
const OTHER = '018f5b4a-7c3a-7c3a-8c3a-000000000002';
const HOME = '018f5b4a-7c3a-7c3a-8c3a-000000000011';
const WORK = '018f5b4a-7c3a-7c3a-8c3a-000000000012';
const FIRST = '018f5b4a-7c3a-7c3a-8c3a-000000000021';
const SECOND = '018f5b4a-7c3a-7c3a-8c3a-000000000022';

let owner: pg.Client;
let other: pg.Client;

beforeAll(async () => {
  const parsed = new URL(DISPOSABLE_URL);
  if (parsed.hostname !== HOST || parsed.port !== String(PORT) || parsed.pathname !== `/${DATABASE}`) {
    throw new Error('Refusing to use a database that is not the disposable address book database');
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
  owner = await waitForPostgres();
  const hosted = await owner.query("SELECT nspname FROM pg_namespace WHERE nspname IN ('auth', 'storage', 'supabase_migrations')");
  if (hosted.rows.length > 0) {
    throw new Error('Refusing a database that already contains hosted Supabase schemas');
  }
  await owner.query(`
    CREATE TYPE "coordinate_source" AS ENUM ('GOOGLE_PLACES', 'DEVICE_GEOCODER', 'UNREVIEWED');
    CREATE TABLE "customer_accounts" ("id" UUID PRIMARY KEY);
  `);
  await owner.query(readFileSync('prisma/migrations/20261117010000_customer_saved_addresses/migration.sql', 'utf8'));
  await owner.query(readFileSync('prisma/migrations/20261119180000_allow_many_home_and_work_addresses/migration.sql', 'utf8'));
  await owner.query('INSERT INTO "customer_accounts" ("id") VALUES ($1), ($2)', [OWNER, OTHER]);
  other = new pg.Client({ connectionString: DISPOSABLE_URL });
  await other.connect();
}, 180_000);

afterAll(async () => {
  await owner?.end().catch(() => undefined);
  await other?.end().catch(() => undefined);
  await exec('docker', ['rm', '-f', CONTAINER], { windowsHide: true }).catch(() => undefined);
}, 60_000);

it('allows many Home and Work rows and one default pickup for each customer', async () => {
  await insert(owner, HOME, OWNER, 'HOME', null, false);
  await insert(owner, WORK, OWNER, 'WORK', null, false);
  await insert(owner, '018f5b4a-7c3a-7c3a-8c3a-000000000013', OWNER, 'HOME', null, false);
  await insert(owner, '018f5b4a-7c3a-7c3a-8c3a-000000000014', OWNER, 'WORK', null, false);
  await insert(owner, '018f5b4a-7c3a-7c3a-8c3a-000000000015', OWNER, 'CUSTOM', 'Mum', false);
  await insert(owner, '018f5b4a-7c3a-7c3a-8c3a-000000000016', OWNER, 'CUSTOM', 'Shop', false);
  await insert(other, '018f5b4a-7c3a-7c3a-8c3a-000000000017', OTHER, 'HOME', null, true);
  await expect(insert(owner, FIRST, OWNER, 'CUSTOM', 'Gate', true)).resolves.toBeUndefined();
  await expect(insert(owner, SECOND, OWNER, 'CUSTOM', 'Other gate', true)).rejects.toMatchObject({ code: '23505' });
});

it('rejects coordinates, labels, and sources the booking rules do not allow', async () => {
  await expect(insert(owner, '018f5b4a-7c3a-7c3a-8c3a-000000000031', OWNER, 'CUSTOM', 'Far', false, '91')).rejects.toMatchObject({ code: '23514' });
  await expect(insert(owner, '018f5b4a-7c3a-7c3a-8c3a-000000000032', OWNER, 'CUSTOM', null, false)).rejects.toMatchObject({ code: '23514' });
  await expect(insert(owner, '018f5b4a-7c3a-7c3a-8c3a-000000000033', OWNER, 'HOME', 'House', false)).rejects.toMatchObject({ code: '23514' });
  await expect(owner.query(
    `INSERT INTO "customer_saved_addresses" (
      "id", "customer_account_id", "label", "custom_label", "address", "latitude", "longitude",
      "place_id", "coordinate_source", "contact_name", "contact_phone", "is_default_pickup", "updated_at"
    ) VALUES ($1, $2, 'CUSTOM', 'Pinned', '12 Samora', -17.8, 31.0, NULL, 'GOOGLE_PLACES', 'Tendai Moyo', '+263771234567', false, NOW())`,
    ['018f5b4a-7c3a-7c3a-8c3a-000000000034', OWNER],
  )).rejects.toMatchObject({ code: '23514' });
});

it('lets concurrent default updates leave one default and does not change deliveries', async () => {
  await owner.query('DELETE FROM "customer_saved_addresses" WHERE "id" = ANY($1)', [[FIRST, SECOND]]);
  await insert(owner, FIRST, OWNER, 'CUSTOM', 'North', false);
  await insert(owner, SECOND, OWNER, 'CUSTOM', 'South', false);
  const results = await Promise.allSettled([
    setDefault(owner, FIRST),
    setDefault(other, SECOND),
  ]);
  const failures = results.filter((result) => result.status === 'rejected');
  expect(failures.length).toBeLessThanOrEqual(1);
  if (failures.length === 1) {
    expect(failures[0]).toMatchObject({ reason: expect.objectContaining({ code: '23505' }) });
    await setDefault(owner, SECOND);
  }
  const defaults = await owner.query(
    'SELECT "id" FROM "customer_saved_addresses" WHERE "customer_account_id" = $1 AND "is_default_pickup"',
    [OWNER],
  );
  expect(defaults.rows).toHaveLength(1);
  await owner.query('DELETE FROM "customer_saved_addresses" WHERE "id" = $1', [FIRST]);
  const remaining = await owner.query('SELECT "id" FROM "customer_saved_addresses" WHERE "customer_account_id" = $1', [OWNER]);
  expect(remaining.rows.some((row) => row.id === FIRST)).toBe(false);
  expect(remaining.rows.some((row) => row.id === SECOND)).toBe(true);
});

async function setDefault(client: pg.Client, id: string) {
  await client.query('BEGIN');
  try {
    await client.query(
      `UPDATE "customer_saved_addresses"
       SET "is_default_pickup" = false, "updated_at" = NOW()
       WHERE "customer_account_id" = $1 AND "is_default_pickup" AND "id" <> $2`,
      [OWNER, id],
    );
    await client.query(
      `UPDATE "customer_saved_addresses"
       SET "is_default_pickup" = true, "updated_at" = NOW()
       WHERE "id" = $1 AND "customer_account_id" = $2`,
      [id, OWNER],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function insert(
  client: pg.Client,
  id: string,
  customerAccountId: string,
  label: string,
  customLabel: string | null,
  isDefault: boolean,
  latitude = '-17.8292000',
) {
  await client.query(
    `INSERT INTO "customer_saved_addresses" (
      "id", "customer_account_id", "label", "custom_label", "address", "latitude", "longitude",
      "place_id", "coordinate_source", "contact_name", "contact_phone", "is_default_pickup", "updated_at"
    ) VALUES ($1, $2, $3::"customer_saved_address_label", $4, '12 Samora', $5, 31.0522000, NULL, 'DEVICE_GEOCODER', 'Tendai Moyo', '+263771234567', $6, NOW())`,
    [id, customerAccountId, label, customLabel, latitude, isDefault],
  );
}

async function waitForPostgres(): Promise<pg.Client> {
  const deadline = Date.now() + 30_000;
  let last: unknown;
  while (Date.now() < deadline) {
    const client = new pg.Client({ connectionString: DISPOSABLE_URL });
    try {
      await client.connect();
      await client.query('SELECT 1');
      return client;
    } catch (error) {
      last = error;
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw last;
}
