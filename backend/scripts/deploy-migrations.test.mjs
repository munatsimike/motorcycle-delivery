import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import pg from 'pg';
import {
  failedMigrationIsClean,
  isKnownGuardCollision,
  isTransactionPooler,
  persistentObjectsPresent,
  PROGRESSIVE_DISPATCH_MIGRATION,
} from './deploy-migrations.mjs';

const backendRoot = resolve(import.meta.dirname, '..');
const migrationsRoot = resolve(backendRoot, 'prisma/migrations');
const adminUrl = 'postgresql://postgres@127.0.0.1:54329/postgres';

function migrationDigest() {
  const hash = createHash('sha256');
  for (const entry of readdirSync(migrationsRoot).sort()) {
    const sql = resolve(migrationsRoot, entry, 'migration.sql');
    try {
      hash.update(entry);
      hash.update(readFileSync(sql));
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        continue;
      }
      throw error;
    }
  }
  return hash.digest('hex');
}

function runDeploy(databaseUrl) {
  return new Promise((done) => {
    const child = spawn(process.execPath, ['scripts/deploy-migrations.mjs'], {
      cwd: backendRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('close', (code) => done({ code: code ?? 1, output }));
  });
}

async function withAdmin(fn) {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function createDatabase(name, options) {
  await withAdmin(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${name}`);
  });
  const client = new pg.Client({ connectionString: `postgresql://postgres@127.0.0.1:54329/${name}` });
  await client.connect();
  try {
    if (options.postgis) {
      await client.query('CREATE EXTENSION postgis');
    }
    if (options.rejectCreateType) {
      await client.query(`
        CREATE FUNCTION reject_create_type() RETURNS event_trigger
        LANGUAGE plpgsql AS $fn$
        BEGIN
          RAISE EXCEPTION 'unrelated migration failure' USING ERRCODE = '42501';
        END
        $fn$
      `);
      await client.query(`
        CREATE EVENT TRIGGER reject_create_type
        ON ddl_command_start
        WHEN TAG IN ('CREATE TYPE')
        EXECUTE FUNCTION reject_create_type()
      `);
    }
    if (options.blockOnGuard) {
      await client.query(`
        CREATE FUNCTION create_rider_locations_on_guard() RETURNS event_trigger
        LANGUAGE plpgsql AS $fn$
        DECLARE
          command record;
        BEGIN
          IF current_setting('riders.creating_block', true) = 'on' THEN
            RETURN;
          END IF;
          FOR command IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
            IF command.object_identity ILIKE '%postgis_catalog_guard%' THEN
              PERFORM set_config('riders.creating_block', 'on', true);
              CREATE TABLE IF NOT EXISTS public.rider_locations (id integer);
            END IF;
          END LOOP;
        END
        $fn$
      `);
      await client.query(`
        CREATE EVENT TRIGGER create_rider_locations_on_guard
        ON ddl_command_end
        WHEN TAG IN ('CREATE TABLE')
        EXECUTE FUNCTION create_rider_locations_on_guard()
      `);
    }
  } finally {
    await client.end();
  }
}

async function migrationRows(name) {
  const client = new pg.Client({ connectionString: `postgresql://postgres@127.0.0.1:54329/${name}` });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back, applied_steps_count
      FROM "_prisma_migrations"
      ORDER BY started_at
    `);
    return result.rows;
  } finally {
    await client.end();
  }
}

const collisionOutput = `
Migration name: 20261014160000_progressive_dispatch
Database error code: 42P07
ERROR: relation "postgis_catalog_guard" already exists
`;

assert.equal(isKnownGuardCollision(collisionOutput), true);
assert.equal(isKnownGuardCollision(collisionOutput.replace('42P07', '42704')), false);
assert.equal(isKnownGuardCollision(collisionOutput.replace('postgis_catalog_guard', 'users')), false);
assert.equal(isTransactionPooler('postgresql://postgres@127.0.0.1:6543/postgres'), true);
assert.equal(isTransactionPooler('postgresql://postgres@127.0.0.1:5432/postgres'), false);
assert.equal(failedMigrationIsClean(null), 'migration history row is missing');
assert.equal(failedMigrationIsClean({
  applied_steps_count: 0,
  finished_at: null,
  rolled_back_at: null,
}), null);
assert.deepEqual(persistentObjectsPresent({ rider_locations: true, postgis_catalog_guard: false }), ['rider_locations']);

const digestBefore = migrationDigest();
const pooler = await runDeploy('postgresql://postgres@127.0.0.1:6543/postgres');
assert.equal(pooler.code, 1);
assert.match(pooler.output, /transaction pooler on port 6543/);
assert.doesNotMatch(pooler.output, /Prisma schema loaded/);

function appliedNames(rows) {
  return new Set(rows.filter((row) => row.finished && !row.rolled_back).map((row) => row.migration_name));
}

await createDatabase('migrate_fresh', { postgis: true });
const fresh = await runDeploy('postgresql://postgres@127.0.0.1:54329/migrate_fresh');
assert.equal(fresh.code, 0, fresh.output);
assert.match(fresh.output, /Recovered the known postgis_catalog_guard collision/);
const freshRows = await migrationRows('migrate_fresh');
assert.equal(appliedNames(freshRows).size, 20);
assert.equal(freshRows.filter((row) => row.migration_name === PROGRESSIVE_DISPATCH_MIGRATION && row.rolled_back && Number(row.applied_steps_count) === 0).length, 1);
const freshObjects = new pg.Client({ connectionString: 'postgresql://postgres@127.0.0.1:54329/migrate_fresh' });
await freshObjects.connect();
const freshShape = await freshObjects.query(`
  SELECT to_regclass('public.rider_locations') IS NOT NULL AS rider_locations,
         to_regtype('public.dispatch_round_status') IS NOT NULL AS dispatch_round_status
`);
await freshObjects.end();
assert.equal(freshShape.rows[0].rider_locations, true);
assert.equal(freshShape.rows[0].dispatch_round_status, true);

const repeated = await runDeploy('postgresql://postgres@127.0.0.1:54329/migrate_fresh');
assert.equal(repeated.code, 0, repeated.output);
assert.doesNotMatch(repeated.output, /Recovered the known postgis_catalog_guard collision/);
assert.equal(appliedNames(await migrationRows('migrate_fresh')).size, 20);

await createDatabase('migrate_blocked', { postgis: true, blockOnGuard: true });
const blocked = await runDeploy('postgresql://postgres@127.0.0.1:54329/migrate_blocked');
assert.notEqual(blocked.code, 0);
assert.match(blocked.output, /Stopped without migrate resolve/);
assert.doesNotMatch(blocked.output, /Recovered the known postgis_catalog_guard collision/);
const blockedRows = await migrationRows('migrate_blocked');
const blockedDispatch = blockedRows.find((row) => row.migration_name === PROGRESSIVE_DISPATCH_MIGRATION);
assert.equal(blockedDispatch.finished, false);
assert.equal(blockedDispatch.rolled_back, false);
assert.equal(Number(blockedDispatch.applied_steps_count), 0);

await createDatabase('migrate_plain', { postgis: true, rejectCreateType: true });
const plain = await runDeploy('postgresql://postgres@127.0.0.1:54329/migrate_plain');
assert.notEqual(plain.code, 0);
assert.doesNotMatch(plain.output, /Stopped without migrate resolve/);
assert.doesNotMatch(plain.output, /Recovered the known postgis_catalog_guard collision/);
assert.doesNotMatch(plain.output, /migrate resolve/);
const plainRows = await migrationRows('migrate_plain');
assert.equal(plainRows.some((row) => row.rolled_back), false);
assert.equal(plainRows.find((row) => row.migration_name === '20261013103200_init_core_delivery_schema').finished, false);

assert.equal(migrationDigest(), digestBefore);
console.log('deploy-migrations tests passed');
