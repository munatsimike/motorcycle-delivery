import { execFile } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';

const exec = promisify(execFile);
const HOST = '127.0.0.1';
const PORT = 54355;
const DATABASE = 'migrate_m5d';
const COLLISION_DATABASE = 'collision_m5d';
const CONTAINER = 'riders-m5d-migrate-pg';
const DISPOSABLE_URL = `postgresql://postgres:postgres@${HOST}:${PORT}/${DATABASE}`;
const COLLISION_URL = `postgresql://postgres:postgres@${HOST}:${PORT}/${COLLISION_DATABASE}`;
const MIGRATIONS = new URL('../../prisma/migrations/', import.meta.url);
const PHASE_3_START = '20261024100000_v2_commission_rates';
const PHASE_5_END = '20261024190000_v2_notice_failure';
const INIT_MIGRATION = '20261013103200_init_core_delivery_schema';
const PROGRESSIVE_MIGRATION = '20261014160000_progressive_dispatch';

let names: string[] = [];

beforeAll(async () => {
  const parsed = new URL(DISPOSABLE_URL);
  if (parsed.hostname !== HOST || parsed.port !== String(PORT) || parsed.pathname !== `/${DATABASE}`) {
    throw new Error('Refusing to use a database that is not the disposable local Phase 5 migration database');
  }
  if (/supabase|railway|pooler/i.test(DISPOSABLE_URL) || /supabase|railway|pooler/i.test(COLLISION_URL)) {
    throw new Error('Refusing a hosted database');
  }
  names = readdirSync(MIGRATIONS)
    .filter((name) => /^\d{14}_/.test(name))
    .sort();
  await exec('docker', ['rm', '-f', CONTAINER], { windowsHide: true }).catch(() => undefined);
  await exec('docker', [
    'run', '-d', '--name', CONTAINER,
    '--publish', `${HOST}:${PORT}:5432`,
    '--env', 'POSTGRES_PASSWORD=postgres',
    '--env', `POSTGRES_DB=${DATABASE}`,
    'postgis/postgis:17-3.5',
  ], { windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
  const observer = await waitForPostgres(DISPOSABLE_URL);
  const hosted = await observer.query("SELECT nspname FROM pg_namespace WHERE nspname IN ('auth', 'storage', 'supabase_migrations')");
  if (hosted.rows.length > 0) {
    await observer.end();
    throw new Error('Refusing a database that already contains hosted Supabase schemas');
  }
  await observer.query(`CREATE DATABASE "${COLLISION_DATABASE}"`);
  await observer.end();
}, 120_000);

afterAll(async () => {
  await exec('docker', ['rm', '-f', CONTAINER], { windowsHide: true }).catch(() => undefined);
});

it('documents the historical same-session postgis guard collision without editing those migrations', async () => {
  const initSql = readFileSync(new URL(`${INIT_MIGRATION}/migration.sql`, MIGRATIONS), 'utf8');
  const progressiveSql = readFileSync(new URL(`${PROGRESSIVE_MIGRATION}/migration.sql`, MIGRATIONS), 'utf8');
  expect(initSql).toContain('CREATE TEMP TABLE "postgis_catalog_guard"');
  expect(progressiveSql).toContain('CREATE TEMP TABLE "postgis_catalog_guard"');
  expect(initSql).not.toContain('DROP TABLE "postgis_catalog_guard"');
  expect(progressiveSql).not.toContain('DROP TABLE "postgis_catalog_guard"');

  const client = new pg.Client({ connectionString: COLLISION_URL });
  await client.connect();
  try {
    for (const statement of sqlStatements(initSql)) {
      await client.query(statement);
    }
    let code = '';
    let message = '';
    try {
      for (const statement of sqlStatements(progressiveSql)) {
        await client.query(statement);
      }
    } catch (error) {
      const caught = error as { code?: string; message?: string };
      code = caught.code ?? '';
      message = caught.message ?? '';
    }
    expect(code).toBe('42P07');
    expect(message).toContain('postgis_catalog_guard');
    expect(message).toContain('already exists');
  } finally {
    await client.end();
  }
}, 120_000);

it('applies the Phase 1/2 baseline and then the pending Phase 3–5 migrations in filename order', async () => {
  const phase3 = names.filter((name) => name >= PHASE_3_START);
  expect(phase3[0]).toBe(PHASE_3_START);
  expect(phase3.at(-1)).toBe(PHASE_5_END);
  expect(phase3).toEqual([
    '20261024100000_v2_commission_rates',
    '20261024110000_v2_commission_snapshots',
    '20261024120000_v2_bid_lifecycle',
    '20261024130000_v2_bid_acceptance',
    '20261024140000_v2_pre_pickup_cancel',
    '20261024150000_v2_phase3_stabilization',
    '20261024160000_v2_flexible_express',
    '20261024170000_v2_delivery_statuses',
    '20261024180000_v2_customer_notices',
    '20261024190000_v2_notice_failure',
  ]);
  for (const name of phase3) {
    const sql = readFileSync(new URL(`${name}/migration.sql`, MIGRATIONS), 'utf8');
    expect(sql.includes('\r')).toBe(false);
    expect(sql.split('\n').some((line) => line.trimStart().startsWith('UPDATE'))).toBe(false);
    expect(sql).not.toContain('INSERT INTO');
  }

  const baseline = names.filter((name) => name < PHASE_3_START);
  expect(baseline.at(-1)).toBe('20261023210000_pricing_class_tariffs');
  for (const name of baseline) {
    await applyMigration(name);
  }

  const midpoint = new pg.Client({ connectionString: DISPOSABLE_URL });
  await midpoint.connect();
  try {
    const tables = await midpoint.query(
      `SELECT c.relname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN ('v2_outbox_events', 'delivery_progress_commands', 'customer_fcm_devices')`,
    );
    expect(tables.rows).toEqual([]);
    const position = await midpoint.query(
      `SELECT udt_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'rider_locations' AND column_name = 'position'`,
    );
    expect(position.rows).toEqual([{ udt_name: 'geography' }]);
  } finally {
    await midpoint.end();
  }

  for (const name of phase3) {
    await applyMigration(name);
  }

  const client = new pg.Client({ connectionString: DISPOSABLE_URL });
  await client.connect();
  try {
    const indexes = await client.query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`,
    );
    const byName = new Map(indexes.rows.map((row) => [row.indexname as string, row.indexdef as string]));
    expect(byName.has('delivery_assignments_one_accepted_per_delivery_idx')).toBe(true);
    expect(byName.has('delivery_assignments_one_accepted_per_rider_idx')).toBe(false);
    expect(byName.get('delivery_assignments_one_live_express_per_rider_idx')).toContain("service_class");
    expect(byName.get('delivery_assignments_one_live_express_per_rider_idx')).toContain('EXPRESS');
    const v1Index = byName.get('delivery_assignments_one_accepted_v1_per_rider_idx') ?? '';
    expect(v1Index).toContain("status");
    expect(v1Index).toContain('ACCEPTED');
    expect(v1Index.toLowerCase()).toContain('accepted_bid_amount is null');
    expect(byName.has('v2_outbox_events_assignment_id_event_type_key')).toBe(true);
    expect(byName.has('delivery_progress_commands_idempotency_key_key')).toBe(true);
    expect(byName.has('customer_fcm_devices_fcm_token_key')).toBe(true);

    const check = await client.query(
      `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conname = 'v2_outbox_events_recipient_chk'`,
    );
    expect(check.rows).toHaveLength(1);
    expect(String(check.rows[0].definition)).toContain('BID_ACCEPTED');
    expect(String(check.rows[0].definition)).toContain('attempt_count');

    const labels = await client.query(
      `SELECT e.enumlabel
         FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname IN ('v2_outbox_event_type', 'v2_outbox_status', 'delivery_status')
        ORDER BY t.typname, e.enumsortorder`,
    );
    const values = labels.rows.map((row) => row.enumlabel as string);
    for (const label of [
      'COLLECTING', 'COLLECTED', 'OUT_FOR_DELIVERY',
      'BID_ACCEPTED', 'REQUEST_REOPENED', 'DEADLINE_REMINDER',
      'PENDING', 'SENT', 'FAILED',
    ]) {
      expect(values).toContain(label);
    }

    const failureColumns = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'v2_outbox_events'
          AND column_name IN ('claimed_at', 'claim_token', 'next_attempt_at', 'last_failure', 'last_attempt_at', 'failed_at')`,
    );
    expect(failureColumns.rows).toHaveLength(6);
  } finally {
    await client.end();
  }
}, 180_000);

async function applyMigration(name: string) {
  const sql = readFileSync(new URL(`${name}/migration.sql`, MIGRATIONS), 'utf8');
  const client = new pg.Client({ connectionString: DISPOSABLE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const statements = sqlStatements(sql);
    for (let index = 0; index < statements.length; index += 1) {
      try {
        await client.query(statements[index]);
      } catch (error) {
        const caught = error as { code?: string; message?: string };
        throw new Error(`${name} statement ${index + 1} failed (${caught.code ?? 'unknown'}): ${caught.message ?? ''}`);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
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

async function waitForPostgres(connectionString: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const client = new pg.Client({ connectionString, connectionTimeoutMillis: 1000 });
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
