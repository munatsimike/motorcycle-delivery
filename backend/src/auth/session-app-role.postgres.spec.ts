import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';

const exec = promisify(execFile);
const MIGRATIONS = new URL('../../prisma/migrations/', import.meta.url);
const HOST = '127.0.0.1';
const PORT = 54374;
const DATABASE = 'session_app_role';
const CONTAINER = 'riders-session-app-role-pg';
const DISPOSABLE_URL = `postgresql://postgres:postgres@${HOST}:${PORT}/${DATABASE}`;

let client: pg.Client;

beforeAll(async () => {
  const parsed = new URL(DISPOSABLE_URL);
  if (parsed.hostname !== HOST || parsed.port !== String(PORT) || parsed.pathname !== `/${DATABASE}`) {
    throw new Error('Refusing to use a database that is not the disposable session-role database');
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
    'postgis/postgis:17-3.5',
  ], { windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
  client = await waitForPostgres();
  const hosted = await client.query("SELECT nspname FROM pg_namespace WHERE nspname IN ('auth', 'storage', 'supabase_migrations')");
  if (hosted.rows.length > 0) {
    throw new Error('Refusing a database that already contains hosted Supabase schemas');
  }
  const names = readdirSync(MIGRATIONS).filter((name) => /^\d{14}_/.test(name)).sort();
  for (const name of names) {
    const sql = readFileSync(new URL(`${name}/migration.sql`, MIGRATIONS), 'utf8');
    const migration = new pg.Client({ connectionString: DISPOSABLE_URL });
    migration.on('error', () => undefined);
    await migration.connect();
    try {
      await migration.query(sql);
    } catch (error) {
      const caught = error as { message?: string };
      throw new Error(`${name} failed: ${caught.message ?? 'unknown error'}`);
    } finally {
      await migration.end().catch(() => undefined);
    }
  }
}, 300_000);

afterAll(async () => {
  await client?.end().catch(() => undefined);
  await exec('docker', ['rm', '-f', CONTAINER], { windowsHide: true }).catch(() => undefined);
}, 60_000);

it('lets the deployed backend omit app_role and still sign in', async () => {
  const userId = await insertUser('CUSTOMER');
  const first = await insertLegacySession(userId);
  const second = await insertLegacySession(userId);
  expect(first.app_role).toBe('CUSTOMER');
  expect(second.app_role).toBe('CUSTOMER');
  const active = await activeSessions(userId);
  expect(active).toEqual([{ id: second.id, app_role: 'CUSTOMER' }]);
});

it('keeps one customer session and one rider session, and blocks a second of either', async () => {
  const userId = await insertUser('CUSTOMER');
  const customer = await insertLegacySession(userId);
  const rider = await insertSession(userId, 'RIDER');
  expect((await activeSessions(userId)).map((row) => row.app_role).sort()).toEqual(['CUSTOMER', 'RIDER']);

  const replacement = await insertSession(userId, 'RIDER');
  const active = await activeSessions(userId);
  expect(active).toEqual([
    { id: customer.id, app_role: 'CUSTOMER' },
    { id: replacement.id, app_role: 'RIDER' },
  ]);
  expect((await client.query('SELECT "revoked_at" FROM "refresh_sessions" WHERE "id" = $1', [rider.id])).rows[0].revoked_at).toBeTruthy();

  const left = new pg.Client({ connectionString: DISPOSABLE_URL });
  const right = new pg.Client({ connectionString: DISPOSABLE_URL });
  await left.connect();
  await right.connect();
  try {
    await Promise.allSettled([
      insertSessionOn(left, userId, 'CUSTOMER'),
      insertSessionOn(right, userId, 'CUSTOMER'),
    ]);
  } finally {
    await left.end().catch(() => undefined);
    await right.end().catch(() => undefined);
  }
  expect((await activeSessions(userId)).filter((row) => row.app_role === 'CUSTOMER')).toHaveLength(1);
});

it('rotates a refresh token without revoking the replacement or rider push tokens', async () => {
  const userId = await insertUser('RIDER');
  const profileId = randomUUID();
  await client.query(
    `INSERT INTO "rider_profiles" ("id", "user_id", "updated_at") VALUES ($1, $2, now())`,
    [profileId, userId],
  );
  const familyId = randomUUID();
  const current = await insertSession(userId, 'RIDER', familyId);
  const keptToken = `kept-${randomUUID()}`;
  const oldToken = `old-${randomUUID()}`;
  await client.query(
    `INSERT INTO "rider_push_devices" ("id", "rider_profile_id", "fcm_token", "updated_at")
     VALUES ($1, $2, $3, now()), ($4, $2, $5, now())`,
    [randomUUID(), profileId, keptToken, randomUUID(), oldToken],
  );
  await client.query('UPDATE "refresh_sessions" SET "revoked_at" = now() WHERE "id" = $1', [current.id]);
  const rotated = await insertSession(userId, 'RIDER', familyId);
  expect((await activeSessions(userId)).map((row) => row.id)).toEqual([rotated.id]);

  const tokens = await client.query(
    `SELECT "fcm_token", "invalidated_at" IS NULL AS fresh
     FROM "rider_push_devices"
     WHERE "rider_profile_id" = $1
     ORDER BY "fcm_token"`,
    [profileId],
  );
  expect(tokens.rows).toEqual([
    { fcm_token: keptToken, fresh: true },
    { fcm_token: oldToken, fresh: true },
  ]);
});

it('stops the previous rider phone on a new sign-in and lets the new phone register again', async () => {
  const userId = await insertUser('RIDER');
  const profileId = randomUUID();
  await client.query(
    `INSERT INTO "rider_profiles" ("id", "user_id", "updated_at") VALUES ($1, $2, now())`,
    [profileId, userId],
  );
  const deviceA = `device-a-${randomUUID()}`;
  const deviceB = `device-b-${randomUUID()}`;
  await client.query(
    `INSERT INTO "rider_push_devices" ("id", "rider_profile_id", "fcm_token", "updated_at")
     VALUES ($1, $2, $3, now())`,
    [randomUUID(), profileId, deviceA],
  );
  await insertSession(userId, 'RIDER');
  const afterReplacement = await client.query(
    `SELECT "invalidated_at" IS NOT NULL AS stopped FROM "rider_push_devices" WHERE "fcm_token" = $1`,
    [deviceA],
  );
  expect(afterReplacement.rows[0].stopped).toBe(true);

  await client.query(
    `INSERT INTO "rider_push_devices" ("id", "rider_profile_id", "fcm_token", "updated_at")
     VALUES ($1, $2, $3, now())
     ON CONFLICT ("fcm_token") DO UPDATE SET "invalidated_at" = NULL, "updated_at" = now()`,
    [randomUUID(), profileId, deviceB],
  );
  const tokens = await client.query(
    `SELECT "fcm_token", "invalidated_at" IS NULL AS fresh
     FROM "rider_push_devices"
     WHERE "rider_profile_id" = $1
     ORDER BY "fcm_token"`,
    [profileId],
  );
  expect(tokens.rows).toEqual([
    { fcm_token: deviceA, fresh: false },
    { fcm_token: deviceB, fresh: true },
  ]);
});

async function insertUser(role: 'CUSTOMER' | 'RIDER'): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO "users" ("id", "full_name", "phone", "role", "account_status", "phone_verified_at", "whatsapp_consent_at", "updated_at")
     VALUES ($1, 'Session Test', $2, $3::"user_role", 'ACTIVE', now(), now(), now())`,
    [id, `+26377${Math.floor(Math.random() * 1_000_0000).toString().padStart(7, '0')}`, role],
  );
  return id;
}

async function insertLegacySession(userId: string): Promise<{ id: string; app_role: string }> {
  const id = randomUUID();
  const inserted = await client.query(
    `INSERT INTO "refresh_sessions" ("id", "user_id", "family_id", "token_hash", "expires_at", "family_expires_at")
     VALUES ($1, $2, $3, $4, now() + interval '30 days', now() + interval '30 days')
     RETURNING "id", "app_role"::text`,
    [id, userId, randomUUID(), randomUUID().replaceAll('-', '').padEnd(64, 'a')],
  );
  return inserted.rows[0];
}

async function insertSession(userId: string, appRole: 'CUSTOMER' | 'RIDER', familyId = randomUUID()): Promise<{ id: string; app_role: string }> {
  return insertSessionOn(client, userId, appRole, familyId);
}

async function insertSessionOn(
  connection: pg.Client,
  userId: string,
  appRole: 'CUSTOMER' | 'RIDER',
  familyId = randomUUID(),
): Promise<{ id: string; app_role: string }> {
  const inserted = await connection.query(
    `INSERT INTO "refresh_sessions"
       ("id", "user_id", "family_id", "app_role", "token_hash", "expires_at", "family_expires_at")
     VALUES ($1, $2, $3, $4::"user_role", $5, now() + interval '30 days', now() + interval '30 days')
     RETURNING "id", "app_role"::text`,
    [randomUUID(), userId, familyId, appRole, randomUUID().replaceAll('-', '').padEnd(64, 'b')],
  );
  return inserted.rows[0];
}

async function activeSessions(userId: string): Promise<Array<{ id: string; app_role: string }>> {
  const result = await client.query(
    `SELECT "id", "app_role"::text
     FROM "refresh_sessions"
     WHERE "user_id" = $1 AND "revoked_at" IS NULL AND "replaced_by_session_id" IS NULL
     ORDER BY "app_role"::text, "id"`,
    [userId],
  );
  return result.rows;
}

async function waitForPostgres(): Promise<pg.Client> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < 180_000) {
    const next = new pg.Client({ connectionString: DISPOSABLE_URL });
    next.on('error', () => undefined);
    try {
      await next.connect();
      await next.query('SELECT 1');
      return next;
    } catch (error) {
      lastError = error;
      await next.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Postgres did not start');
}
