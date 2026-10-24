import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { commissionCents } from './commission-calculator.js';

const exec = promisify(execFile);
const HOST = '127.0.0.1';
const PORT = 54342;
const DATABASE = 'commission_m2';
const CONTAINER = 'riders-m2-commission-snapshot-pg';
const DISPOSABLE_URL = `postgresql://postgres:postgres@${HOST}:${PORT}/${DATABASE}`;
const ADMIN = '00000000-0000-7000-8000-0000000000a1';
const ASSIGNMENT = '00000000-0000-7000-8000-0000000000b1';

let observer: pg.Client;

beforeAll(async () => {
  const parsed = new URL(DISPOSABLE_URL);
  if (parsed.hostname !== HOST || parsed.port !== String(PORT) || parsed.pathname !== `/${DATABASE}`) {
    throw new Error('Refusing to use a database that is not the disposable local snapshot test database');
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
  await observer.query('CREATE TABLE "users" ("id" UUID PRIMARY KEY)');
  await applySql(observer, 'prisma/migrations/20261024100000_v2_commission_rates/migration.sql');
  await observer.query('CREATE TABLE "delivery_assignments" ("id" UUID PRIMARY KEY, "label" TEXT)');
  await applySql(observer, 'prisma/migrations/20261024110000_v2_commission_snapshots/migration.sql');
  await observer.query('INSERT INTO "users" ("id") VALUES ($1)', [ADMIN]);
  await observer.query(
    `INSERT INTO v2_commission_rates (id, rate_version, basis_points, is_active, created_by_id)
     VALUES (gen_random_uuid(), 1, 1000, true, $1)`,
    [ADMIN],
  );
  await observer.query('INSERT INTO delivery_assignments (id, label) VALUES ($1, $2)', [ASSIGNMENT, 'open']);
}, 180_000);

afterAll(async () => {
  await observer?.end().catch(() => undefined);
  await exec('docker', ['rm', '-f', CONTAINER], { windowsHide: true }).catch(() => undefined);
}, 60_000);

it('accepts 0%, 100%, and half-cent rounding, and rejects a mismatched amount', async () => {
  await inRolledBackTransaction((client) => writeSnapshot(client, 500, 0, 0));
  await inRolledBackTransaction((client) => writeSnapshot(client, 500, 10_000, 500));
  await inRolledBackTransaction((client) => writeSnapshot(client, 1, 5_000, commissionCents(1, 5_000)));
  await inRolledBackTransaction((client) => expectRejection(
    () => writeSnapshot(client, 1, 5_000, 0),
    '23514',
    'delivery_assignments_v2_commission_snapshot_chk',
  ));
  const stored = await observer.query('SELECT accepted_bid_amount FROM delivery_assignments WHERE id = $1', [ASSIGNMENT]);
  expect(stored.rows[0]?.accepted_bid_amount).toBeNull();
});

it('keeps a committed snapshot when the published rate later changes', async () => {
  const bidCents = 1_000;
  const basisPoints = 1_000;
  await observer.query(
    `UPDATE delivery_assignments
        SET accepted_bid_amount = $2,
            accepted_commission_basis_points = $3,
            accepted_v2_commission_rate_version = 1,
            accepted_commission_amount = $4,
            label = 'accepted'
      WHERE id = $1`,
    [ASSIGNMENT, centsToDecimal(bidCents), basisPoints, centsToDecimal(commissionCents(bidCents, basisPoints))],
  );
  await observer.query('UPDATE delivery_assignments SET label = $2 WHERE id = $1', [ASSIGNMENT, 'collecting']);
  await expect(observer.query(
    'UPDATE delivery_assignments SET accepted_commission_basis_points = 2500 WHERE id = $1',
    [ASSIGNMENT],
  )).rejects.toMatchObject({ code: 'P0001' });
  await observer.query(
    `INSERT INTO v2_commission_rates (id, rate_version, basis_points, is_active, created_by_id)
     VALUES (gen_random_uuid(), 2, 2500, false, $1)`,
    [ADMIN],
  );
  await observer.query('UPDATE v2_commission_rates SET basis_points = 5000 WHERE rate_version = 1');
  await expect(observer.query('UPDATE v2_commission_rates SET rate_version = 9 WHERE rate_version = 1')).rejects.toMatchObject({
    code: '23503',
    constraint: 'delivery_assignments_v2_commission_rate_version_fkey',
  });
  const snapshot = await observer.query<{
    accepted_bid_amount: string;
    accepted_commission_basis_points: number;
    accepted_v2_commission_rate_version: number;
    accepted_commission_amount: string;
    label: string;
  }>(
    `SELECT accepted_bid_amount::text, accepted_commission_basis_points, accepted_v2_commission_rate_version,
            accepted_commission_amount::text, label
       FROM delivery_assignments WHERE id = $1`,
    [ASSIGNMENT],
  );
  expect(snapshot.rows[0]).toEqual({
    accepted_bid_amount: '10.00',
    accepted_commission_basis_points: 1000,
    accepted_v2_commission_rate_version: 1,
    accepted_commission_amount: '1.00',
    label: 'collecting',
  });
});

async function writeSnapshot(client: pg.PoolClient, bidCents: number, basisPoints: number, amountCents: number) {
  await client.query(
    `UPDATE delivery_assignments
        SET accepted_bid_amount = $2,
            accepted_commission_basis_points = $3,
            accepted_v2_commission_rate_version = 1,
            accepted_commission_amount = $4
      WHERE id = $1`,
    [ASSIGNMENT, centsToDecimal(bidCents), basisPoints, centsToDecimal(amountCents)],
  );
}

function centsToDecimal(cents: number) {
  const whole = Math.trunc(cents / 100);
  const fraction = String(Math.abs(cents) % 100).padStart(2, '0');
  return `${whole}.${fraction}`;
}

async function inRolledBackTransaction(run: (client: pg.PoolClient) => Promise<void>) {
  const pool = new pg.Pool({ connectionString: DISPOSABLE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await run(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
}

async function expectRejection(run: () => Promise<unknown>, code: string, constraint: string) {
  try {
    await run();
  } catch (error) {
    expect(error).toMatchObject({ code, constraint });
    return;
  }
  throw new Error(`PostgreSQL accepted a snapshot constrained by ${constraint}`);
}

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
      if (!dollar) {
        dollar = tag[0];
      } else if (dollar === tag[0]) {
        dollar = '';
      }
      current += tag[0];
      index += tag[0].length - 1;
      continue;
    }
    if (!dollar && sql[index] === ';') {
      if (current.trim()) {
        statements.push(current.trim());
      }
      current = '';
      continue;
    }
    current += sql[index];
  }
  if (current.trim()) {
    statements.push(current.trim());
  }
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
