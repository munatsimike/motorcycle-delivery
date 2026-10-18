import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

const backendRoot = resolve(import.meta.dirname, '..');
const require = createRequire(resolve(backendRoot, 'package.json'));
const prismaBin = require.resolve('prisma/build/index.js');

export const PROGRESSIVE_DISPATCH_MIGRATION = '20261014160000_progressive_dispatch';

const persistentObjectLabels = [
  'postgis_catalog_guard',
  'rider_locations',
  'delivery_dispatch_rounds',
  'dispatch_round_status',
  'deliveries.search_generation',
  'delivery_assignments.search_generation',
  'delivery_assignments.idempotency_key',
  'delivery_assignments.payload_hash',
  'rider_locations_position_gix',
  'delivery_dispatch_rounds_generation_round_key',
  'delivery_dispatch_rounds_status_due_at_idx',
  'delivery_assignments_idempotency_key_key',
  'rider_locations_coordinate_chk',
  'delivery_dispatch_rounds_round_chk',
  'delivery_dispatch_rounds_status_chk',
  'deliveries_search_generation_chk',
  'delivery_assignments_accept_idempotency_chk',
];

export function connectionPort(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return null;
  }
  return parsed.port || '5432';
}

export function isTransactionPooler(databaseUrl) {
  return connectionPort(databaseUrl) === '6543';
}

export function isKnownGuardCollision(output) {
  return output.includes(PROGRESSIVE_DISPATCH_MIGRATION)
    && output.includes('42P07')
    && output.includes('postgis_catalog_guard')
    && output.includes('already exists');
}

export function failedMigrationIsClean(row) {
  if (!row) {
    return 'migration history row is missing';
  }
  if (Number(row.applied_steps_count) !== 0) {
    return 'applied steps were recorded';
  }
  if (row.finished_at !== null) {
    return 'migration is marked finished';
  }
  if (row.rolled_back_at !== null) {
    return 'migration is already marked rolled back';
  }
  return null;
}

export function persistentObjectsPresent(row) {
  if (!row) {
    return persistentObjectLabels;
  }
  return persistentObjectLabels.filter((label) => row[label] === true);
}

function readDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  const envFile = resolve(backendRoot, '.env');
  if (!existsSync(envFile)) {
    return undefined;
  }
  process.loadEnvFile(envFile);
  return process.env.DATABASE_URL;
}

function safeError(error) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN';
  const message = error instanceof Error ? error.message : 'database check failed';
  return `${code}: ${message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]')}`;
}

function runPrisma(args) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [prismaBin, ...args], {
      cwd: backendRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const collect = (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('close', (code) => done({ code: code ?? 1, output }));
  });
}

async function progressiveDispatchState(databaseUrl) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const objects = await client.query(`
      SELECT
        EXISTS (
          SELECT 1
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relname = 'postgis_catalog_guard'
        ) AS "postgis_catalog_guard",
        to_regclass('public.rider_locations') IS NOT NULL AS "rider_locations",
        to_regclass('public.delivery_dispatch_rounds') IS NOT NULL AS "delivery_dispatch_rounds",
        to_regtype('public.dispatch_round_status') IS NOT NULL AS "dispatch_round_status",
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'deliveries' AND column_name = 'search_generation'
        ) AS "deliveries.search_generation",
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'delivery_assignments' AND column_name = 'search_generation'
        ) AS "delivery_assignments.search_generation",
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'delivery_assignments' AND column_name = 'idempotency_key'
        ) AS "delivery_assignments.idempotency_key",
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'delivery_assignments' AND column_name = 'payload_hash'
        ) AS "delivery_assignments.payload_hash",
        EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'rider_locations_position_gix'
        ) AS "rider_locations_position_gix",
        EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'delivery_dispatch_rounds_generation_round_key'
        ) AS "delivery_dispatch_rounds_generation_round_key",
        EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'delivery_dispatch_rounds_status_due_at_idx'
        ) AS "delivery_dispatch_rounds_status_due_at_idx",
        EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'delivery_assignments_idempotency_key_key'
        ) AS "delivery_assignments_idempotency_key_key",
        EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'rider_locations_coordinate_chk'
        ) AS "rider_locations_coordinate_chk",
        EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'delivery_dispatch_rounds_round_chk'
        ) AS "delivery_dispatch_rounds_round_chk",
        EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'delivery_dispatch_rounds_status_chk'
        ) AS "delivery_dispatch_rounds_status_chk",
        EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'deliveries_search_generation_chk'
        ) AS "deliveries_search_generation_chk",
        EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'delivery_assignments_accept_idempotency_chk'
        ) AS "delivery_assignments_accept_idempotency_chk"
    `);
    const history = await client.query(`
      SELECT finished_at, rolled_back_at, applied_steps_count
      FROM "_prisma_migrations"
      WHERE migration_name = $1
    `, [PROGRESSIVE_DISPATCH_MIGRATION]);
    if (objects.rows.length !== 1 || history.rows.length !== 1) {
      return { clean: false, reason: 'schema check did not return exactly one result' };
    }
    const present = persistentObjectsPresent(objects.rows[0]);
    if (present.length > 0) {
      return { clean: false, reason: `persistent objects exist: ${present.join(', ')}` };
    }
    const historyProblem = failedMigrationIsClean(history.rows[0]);
    if (historyProblem) {
      return { clean: false, reason: historyProblem };
    }
    return { clean: true };
  } finally {
    await client.end();
  }
}

export async function main() {
  const databaseUrl = readDatabaseUrl();
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set.');
    return 1;
  }
  if (connectionPort(databaseUrl) === null) {
    console.error('DATABASE_URL could not be parsed.');
    return 1;
  }
  if (isTransactionPooler(databaseUrl)) {
    console.error('Refusing to deploy migrations through the transaction pooler on port 6543.');
    return 1;
  }

  const first = await runPrisma(['migrate', 'deploy']);
  if (first.code === 0) {
    return 0;
  }
  if (!isKnownGuardCollision(first.output)) {
    return first.code;
  }

  let state;
  try {
    state = await progressiveDispatchState(databaseUrl);
  } catch (error) {
    console.error(`Stopped without migrate resolve. Schema check failed: ${safeError(error)}`);
    return 1;
  }
  if (!state.clean) {
    console.error(`Stopped without migrate resolve. ${state.reason}.`);
    return 1;
  }

  const resolved = await runPrisma([
    'migrate',
    'resolve',
    '--rolled-back',
    PROGRESSIVE_DISPATCH_MIGRATION,
  ]);
  if (resolved.code !== 0) {
    return resolved.code;
  }

  const second = await runPrisma(['migrate', 'deploy']);
  if (second.code === 0) {
    console.log('Recovered the known postgis_catalog_guard collision in a new session.');
  }
  return second.code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(safeError(error));
    process.exitCode = 1;
  });
}
