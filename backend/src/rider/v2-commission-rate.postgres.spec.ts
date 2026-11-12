import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { V2CommissionRateService } from './v2-commission-rate.service.js';

const exec = promisify(execFile);
const HOST = '127.0.0.1';
const PORT = 54341;
const DATABASE = 'commission_m1';
const CONTAINER = 'riders-m1-commission-pg';
const DISPOSABLE_URL = `postgresql://postgres:postgres@${HOST}:${PORT}/${DATABASE}`;
const ADMIN_A = '00000000-0000-7000-8000-000000000001';
const ADMIN_B = '00000000-0000-7000-8000-000000000002';
const PUBLISHERS = ['v2-publisher-a', 'v2-publisher-b'];

let observer: pg.Client;
let publisherA: Publisher;
let publisherB: Publisher;

beforeAll(async () => {
  assertDisposableTarget();
  await exec('docker', ['rm', '-f', CONTAINER], { windowsHide: true }).catch(() => undefined);
  await exec('docker', [
    'run', '-d', '--name', CONTAINER,
    '--publish', `${HOST}:${PORT}:5432`,
    '--env', 'POSTGRES_PASSWORD=postgres',
    '--env', `POSTGRES_DB=${DATABASE}`,
    'postgres:17-alpine',
  ], { windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
  observer = await waitForPostgres();
  const identity = await observer.query<{ current_database: string }>('SELECT current_database()');
  if (identity.rows[0]?.current_database !== DATABASE) {
    throw new Error('Disposable database identity did not match');
  }
  const hosted = await observer.query<{ nspname: string }>(
    "SELECT nspname FROM pg_namespace WHERE nspname IN ('auth', 'storage', 'supabase_migrations')",
  );
  if (hosted.rows.length > 0) {
    throw new Error('Refusing a database that already contains hosted Supabase schemas');
  }
  await observer.query('CREATE TABLE "users" ("id" UUID PRIMARY KEY)');
  await applyMigration(observer);
  await observer.query('INSERT INTO "users" ("id") VALUES ($1), ($2)', [ADMIN_A, ADMIN_B]);
  publisherA = createPublisher('v2-publisher-a');
  publisherB = createPublisher('v2-publisher-b');
}, 180_000);

afterAll(async () => {
  await publisherA?.prisma.$disconnect().catch(() => undefined);
  await publisherB?.prisma.$disconnect().catch(() => undefined);
  await publisherA?.pool.end().catch(() => undefined);
  await publisherB?.pool.end().catch(() => undefined);
  await observer?.end().catch(() => undefined);
  await exec('docker', ['rm', '-f', CONTAINER], { windowsHide: true }).catch(() => undefined);
}, 60_000);

it('creates the rate-version unique index and the one-active index in PostgreSQL', async () => {
  const indexes = await observer.query<{ indexname: string; indexdef: string }>(
    `SELECT indexname, indexdef FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname IN (
         'v2_commission_rates_rate_version_key',
         'v2_commission_rates_one_active_idx',
         'v2_commission_rate_audits_next_version_key'
       )
     ORDER BY indexname`,
  );
  expect(indexes.rows.map((row) => row.indexname)).toEqual([
    'v2_commission_rate_audits_next_version_key',
    'v2_commission_rates_one_active_idx',
    'v2_commission_rates_rate_version_key',
  ]);
  const version = indexes.rows.find((row) => row.indexname === 'v2_commission_rates_rate_version_key');
  const active = indexes.rows.find((row) => row.indexname === 'v2_commission_rates_one_active_idx');
  expect(version?.indexdef).toContain('UNIQUE');
  expect(version?.indexdef).toContain('rate_version');
  expect(active?.indexdef).toContain('UNIQUE');
  expect(active?.indexdef.toLowerCase()).toContain('where');
  expect(active?.indexdef).toContain('is_active');
});

it('accepts a configured 0% rate and rejects a second active rate', async () => {
  await expectCommittedCount(0);
  await inRolledBackTransaction(async (client) => {
    await client.query(rateInsert(1, 0, true));
    const stored = await client.query<{ basis_points: number; is_active: boolean }>(
      'SELECT basis_points, is_active FROM v2_commission_rates',
    );
    expect(stored.rows).toEqual([{ basis_points: 0, is_active: true }]);
    await expectDatabaseRejection(
      () => client.query(rateInsert(2, 1000, true)),
      '23505',
      'v2_commission_rates_one_active_idx',
    );
  });
  await expectCommittedCount(0);
});

it('rejects a duplicate rate version', async () => {
  await inRolledBackTransaction(async (client) => {
    await client.query(rateInsert(7, 0, false));
    await expectDatabaseRejection(
      () => client.query(rateInsert(7, 100, false)),
      '23505',
      'v2_commission_rates_rate_version_key',
    );
  });
});

it('rejects basis points outside 0 through 10000 and accepts both endpoints', async () => {
  await inRolledBackTransaction(async (client) => {
    await expectDatabaseRejection(
      () => client.query(rateInsert(1, -1, false)),
      '23514',
      'v2_commission_rates_basis_points_chk',
    );
  });
  await inRolledBackTransaction(async (client) => {
    await expectDatabaseRejection(
      () => client.query(rateInsert(1, 10001, false)),
      '23514',
      'v2_commission_rates_basis_points_chk',
    );
  });
  await inRolledBackTransaction(async (client) => {
    await client.query(rateInsert(1, 0, false));
    await client.query(rateInsert(2, 10000, false));
    const stored = await client.query<{ basis_points: number }>('SELECT basis_points FROM v2_commission_rates ORDER BY basis_points');
    expect(stored.rows.map((row) => row.basis_points)).toEqual([0, 10000]);
  });
});

it('rejects two audit rows for one rate version', async () => {
  await inRolledBackTransaction(async (client) => {
    await client.query(auditInsert(1));
    await expectDatabaseRejection(
      () => client.query(auditInsert(1)),
      '23505',
      'v2_commission_rate_audits_next_version_key',
    );
  });
});

it('rolls back the rate change when the audit insert fails', async () => {
  await clearRates();
  const first = await publisherA.service.publish({ userId: ADMIN_A }, { percentage: '10' });
  expect(first).toEqual(expect.objectContaining({ basisPoints: 1000, rateVersion: 1, configured: true }));
  await observer.query(`
    CREATE FUNCTION m1_audit_insert_fail() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'audit insert failed';
    END;
    $$
  `);
  await observer.query(`
    CREATE TRIGGER m1_audit_insert_fail
    BEFORE INSERT ON v2_commission_rate_audits
    FOR EACH ROW EXECUTE FUNCTION m1_audit_insert_fail()
  `);
  try {
    await expect(publisherA.service.publish({ userId: ADMIN_A }, { percentage: '20' })).rejects.toThrow();
    const rates = await observer.query<{ rate_version: number; basis_points: number; is_active: boolean }>(
      'SELECT rate_version, basis_points, is_active FROM v2_commission_rates ORDER BY rate_version',
    );
    const audits = await observer.query<{ next_version: number; next_basis_points: number }>(
      'SELECT next_version, next_basis_points FROM v2_commission_rate_audits ORDER BY next_version',
    );
    expect(rates.rows).toEqual([{ rate_version: 1, basis_points: 1000, is_active: true }]);
    expect(audits.rows).toEqual([{ next_version: 1, next_basis_points: 1000 }]);
  } finally {
    await observer.query('DROP TRIGGER IF EXISTS m1_audit_insert_fail ON v2_commission_rate_audits');
    await observer.query('DROP FUNCTION IF EXISTS m1_audit_insert_fail()');
  }
});

it('publishes from two PostgreSQL connections without duplicate versions', async () => {
  await clearRates();
  const identical = await publishConcurrently('15', '15');
  expect(identical.pids.size).toBe(2);
  expect([identical.first.rateVersion, identical.second.rateVersion]).toEqual([1, 1]);
  expect(identical.first.basisPoints).toBe(1500);
  await expectRateRows([{ rate_version: 1, basis_points: 1500, is_active: true }]);
  await expectAuditCount(1);

  await clearRates();
  const different = await publishConcurrently('10', '25');
  expect(different.pids.size).toBe(2);
  expect([different.first.rateVersion, different.second.rateVersion].sort((left, right) => left - right)).toEqual([1, 2]);
  const rows = await observer.query<{ rate_version: number; basis_points: number; is_active: boolean }>(
    'SELECT rate_version, basis_points, is_active FROM v2_commission_rates ORDER BY rate_version',
  );
  expect(rows.rows.map((row) => row.rate_version)).toEqual([1, 2]);
  expect(rows.rows.map((row) => row.basis_points).sort((left, right) => left - right)).toEqual([1000, 2500]);
  expect(rows.rows.filter((row) => row.is_active).map((row) => row.rate_version)).toEqual([2]);
  await expectAuditCount(2);
}, 30_000);

function assertDisposableTarget() {
  const parsed = new URL(DISPOSABLE_URL);
  if (parsed.hostname !== HOST || parsed.port !== String(PORT) || parsed.pathname !== `/${DATABASE}`) {
    throw new Error('Refusing to use a database that is not the disposable local commission test database');
  }
  if (/supabase|railway|pooler/i.test(DISPOSABLE_URL)) {
    throw new Error('Refusing a hosted database');
  }
}

async function waitForPostgres() {
  let lastError: unknown;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const client = new pg.Client({ connectionString: DISPOSABLE_URL, application_name: 'v2-observer', connectionTimeoutMillis: 1000 });
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

async function applyMigration(client: pg.Client) {
  const sql = readFileSync('prisma/migrations/20261024100000_v2_commission_rates/migration.sql', 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  for (const statement of sql.split(';').map((part) => part.trim()).filter((part) => part.length > 0)) {
    await client.query(statement);
  }
}

function createPublisher(applicationName: string): Publisher {
  const pool = new pg.Pool({ connectionString: DISPOSABLE_URL, max: 1, application_name: applicationName });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  return { pool, prisma, service: new V2CommissionRateService(prisma as unknown as PrismaService) };
}

async function inRolledBackTransaction(run: (client: pg.PoolClient) => Promise<void>) {
  const client = await publisherA.pool.connect();
  try {
    await client.query('BEGIN');
    await run(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

async function expectDatabaseRejection(run: () => Promise<unknown>, code: string, constraint: string) {
  try {
    await run();
  } catch (error) {
    expect(error).toMatchObject({ code, constraint });
    return;
  }
  throw new Error(`PostgreSQL accepted a row constrained by ${constraint}`);
}

function rateInsert(version: number, basisPoints: number, active: boolean) {
  return {
    text: `INSERT INTO v2_commission_rates (id, rate_version, basis_points, is_active, created_by_id)
           VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
    values: [version, basisPoints, active, ADMIN_A],
  };
}

function auditInsert(nextVersion: number) {
  return {
    text: `INSERT INTO v2_commission_rate_audits
             (id, actor_id, previous_version, next_version, previous_basis_points, next_basis_points)
           VALUES (gen_random_uuid(), $1, NULL, $2, NULL, 0)`,
    values: [ADMIN_A, nextVersion],
  };
}

async function clearRates() {
  await observer.query('TRUNCATE TABLE v2_commission_rate_audits, v2_commission_rates');
}

async function expectCommittedCount(count: number) {
  const result = await observer.query<{ count: number }>('SELECT count(*)::int AS count FROM v2_commission_rates');
  expect(result.rows[0]?.count).toBe(count);
}

async function expectAuditCount(count: number) {
  const result = await observer.query<{ count: number }>('SELECT count(*)::int AS count FROM v2_commission_rate_audits');
  expect(result.rows[0]?.count).toBe(count);
}

async function expectRateRows(rows: Array<{ rate_version: number; basis_points: number; is_active: boolean }>) {
  const result = await observer.query<{ rate_version: number; basis_points: number; is_active: boolean }>(
    'SELECT rate_version, basis_points, is_active FROM v2_commission_rates ORDER BY rate_version',
  );
  expect(result.rows).toEqual(rows);
}

async function publishConcurrently(left: string, right: string) {
  await observer.query('SELECT pg_advisory_lock(724311, 3)');
  const pending = Promise.all([
    publisherA.service.publish({ userId: ADMIN_A }, { percentage: left }),
    publisherB.service.publish({ userId: ADMIN_B }, { percentage: right }),
  ]);
  let pids = new Set<number>();
  try {
    pids = await waitForPublisherPids();
  } finally {
    await observer.query('SELECT pg_advisory_unlock(724311, 3)');
  }
  const [first, second] = await pending;
  return { first, second, pids };
}

async function waitForPublisherPids() {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    const activity = await observer.query<{ pid: number }>(
      `SELECT pid FROM pg_stat_activity
       WHERE application_name = ANY($1::text[])
         AND state = 'active'
         AND query LIKE '%pg_advisory_xact_lock%'`,
      [PUBLISHERS],
    );
    const pids = new Set(activity.rows.map((row) => row.pid));
    if (pids.size === 2) {
      return pids;
    }
    await delay(50);
  }
  throw new Error('The two publication connections did not both reach PostgreSQL');
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

type Publisher = {
  pool: pg.Pool;
  prisma: PrismaClient;
  service: V2CommissionRateService;
};
