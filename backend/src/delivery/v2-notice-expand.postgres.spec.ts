import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';

const exec = promisify(execFile);
const HOST = '127.0.0.1';
const PORT = 54357;
const DATABASE = 'notice_expand';
const CONTAINER = 'riders-notice-expand-pg';
const DISPOSABLE_URL = `postgresql://postgres:postgres@${HOST}:${PORT}/${DATABASE}`;
const MIGRATIONS = new URL('../../prisma/migrations/', import.meta.url);
const DELIVERY = '10000000-0000-4000-8000-000000000001';
const ASSIGNMENT = '10000000-0000-4000-8000-000000000002';
const RIDER = '10000000-0000-4000-8000-000000000003';
const CUSTOMER = '10000000-0000-4000-8000-000000000004';
const EXISTING = '10000000-0000-4000-8000-000000000005';
const LATE_ASSIGNMENT = '10000000-0000-4000-8000-000000000006';
const LATE_DELIVERY = '10000000-0000-4000-8000-000000000007';

const PREVIOUS_REMINDER = `INSERT INTO "v2_outbox_events" (
  "id", "event_type", "status", "delivery_id", "assignment_id",
  "customer_account_id", "attempt_count", "created_at"
)
SELECT gen_random_uuid(),
       'DEADLINE_REMINDER'::"v2_outbox_event_type",
       'PENDING'::"v2_outbox_status",
       delivery."id",
       assignment."id",
       delivery."customer_id",
       0,
       $1
FROM "delivery_assignments" AS assignment
INNER JOIN "deliveries" AS delivery ON delivery."id" = assignment."delivery_id"
WHERE assignment."status" = 'ACCEPTED'::"assignment_status"
  AND assignment."accepted_bid_amount" IS NOT NULL
  AND delivery."deliver_by" IS NOT NULL
  AND delivery."deliver_by" < $1
  AND delivery."status" IN (
    'RIDER_ASSIGNED'::"delivery_status",
    'COLLECTING'::"delivery_status",
    'COLLECTED'::"delivery_status",
    'OUT_FOR_DELIVERY'::"delivery_status"
  )
ON CONFLICT ("assignment_id", "event_type") DO NOTHING`;

const NEXT_NOTICE = `INSERT INTO "v2_outbox_events" (
  "id", "event_type", "status", "delivery_id", "assignment_id",
  "rider_profile_id", "customer_account_id", "attempt_count", "created_at", "dedupe_key"
) VALUES (
  gen_random_uuid(),
  $1::"v2_outbox_event_type",
  'PENDING'::"v2_outbox_status",
  $2::uuid,
  NULL,
  $3::uuid,
  $4::uuid,
  0,
  $5::timestamptz,
  $6
)
ON CONFLICT ("dedupe_key") DO NOTHING`;

let client: pg.Client;

beforeAll(async () => {
  const parsed = new URL(DISPOSABLE_URL);
  if (parsed.hostname !== HOST || parsed.port !== String(PORT) || parsed.pathname !== `/${DATABASE}`) {
    throw new Error('Refusing to use a database that is not the disposable notice expansion database');
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
  client = await waitForPostgres();
  await client.query(PREVIOUS_SCHEMA);
  await client.query(
    `INSERT INTO "deliveries" ("id", "customer_id", "deliver_by", "status")
     VALUES ($1, $2, $3, 'COLLECTED'::"delivery_status"),
            ($4, $2, $5, 'RIDER_ASSIGNED'::"delivery_status")`,
    [DELIVERY, CUSTOMER, new Date('2026-10-24T18:00:00.000Z'), LATE_DELIVERY, new Date('2026-10-24T07:00:00.000Z')],
  );
  await client.query(
    `INSERT INTO "delivery_assignments" ("id", "delivery_id", "status", "accepted_bid_amount")
     VALUES ($1, $2, 'ACCEPTED'::"assignment_status", 10),
            ($3, $4, 'ACCEPTED'::"assignment_status", 10)`,
    [ASSIGNMENT, DELIVERY, LATE_ASSIGNMENT, LATE_DELIVERY],
  );
  await client.query(
    `INSERT INTO "v2_outbox_events" (
       "id", "event_type", "status", "delivery_id", "assignment_id", "rider_profile_id", "attempt_count"
     ) VALUES ($1, 'BID_ACCEPTED', 'PENDING', $2, $3, $4, 0)`,
    [EXISTING, DELIVERY, ASSIGNMENT, RIDER],
  );
  await applyFile('20261101170000_marketplace_push_notice_types');
  await applyFile('20261101170100_marketplace_push_notice_rows');
}, 120_000);

afterAll(async () => {
  await client?.end().catch(() => undefined);
  await exec('docker', ['rm', '-f', CONTAINER], { windowsHide: true }).catch(() => undefined);
});

it('keeps the previous API writing assignment notices after the expansion', async () => {
  const preserved = await client.query(
    `SELECT "dedupe_key", "status", "delivery_id", "assignment_id"
       FROM "v2_outbox_events" WHERE "id" = $1`,
    [EXISTING],
  );
  expect(preserved.rows[0]).toMatchObject({
    dedupe_key: `assignment:${ASSIGNMENT}:BID_ACCEPTED`,
    status: 'PENDING',
    delivery_id: DELIVERY,
    assignment_id: ASSIGNMENT,
  });

  await client.query(
    `INSERT INTO "v2_outbox_events" (
       "id", "event_type", "status", "delivery_id", "assignment_id",
       "customer_account_id", "attempt_count", "created_at"
     ) VALUES (
       gen_random_uuid(), 'COLLECTED'::"v2_outbox_event_type", 'PENDING'::"v2_outbox_status",
       $1, $2, $3, 0, $4
     )`,
    [DELIVERY, ASSIGNMENT, CUSTOMER, new Date('2026-10-24T08:00:00.000Z')],
  );
  const collected = await client.query(
    `SELECT "dedupe_key" FROM "v2_outbox_events"
      WHERE "assignment_id" = $1 AND "event_type" = 'COLLECTED'`,
    [ASSIGNMENT],
  );
  expect(collected.rows).toEqual([{ dedupe_key: `assignment:${ASSIGNMENT}:COLLECTED` }]);
  await expect(client.query(
    `INSERT INTO "v2_outbox_events" (
       "id", "event_type", "status", "delivery_id", "assignment_id",
       "customer_account_id", "attempt_count"
     ) VALUES (gen_random_uuid(), 'COLLECTED', 'PENDING', $1, $2, $3, 0)`,
    [DELIVERY, ASSIGNMENT, CUSTOMER],
  )).rejects.toMatchObject({ code: '23505' });

  const now = new Date('2026-10-24T08:00:00.000Z');
  await client.query(PREVIOUS_REMINDER, [now]);
  await client.query(PREVIOUS_REMINDER, [now]);
  const reminders = await client.query(
    `SELECT "dedupe_key" FROM "v2_outbox_events"
      WHERE "assignment_id" = $1 AND "event_type" = 'DEADLINE_REMINDER'`,
    [LATE_ASSIGNMENT],
  );
  expect(reminders.rows).toEqual([{ dedupe_key: `assignment:${LATE_ASSIGNMENT}:DEADLINE_REMINDER` }]);

  const nullable = await client.query(
    `SELECT "is_nullable" FROM information_schema.columns
      WHERE table_name = 'v2_outbox_events' AND column_name = 'dedupe_key'`,
  );
  expect(nullable.rows[0]?.is_nullable).toBe('NO');
});

it('accepts the next API notices and still accepts the previous API afterwards', async () => {
  const opened = new Date('2026-10-24T08:00:00.000Z');
  await client.query(NEXT_NOTICE, ['BID_RECEIVED', DELIVERY, null, CUSTOMER, opened, 'bid:one:BID_RECEIVED']);
  await client.query(NEXT_NOTICE, ['BID_RECEIVED', DELIVERY, null, CUSTOMER, opened, 'bid:one:BID_RECEIVED']);
  await client.query(NEXT_NOTICE, ['RIDER_OPPORTUNITY', DELIVERY, null, null, opened, 'opportunity:one']);
  await client.query(NEXT_NOTICE, ['ACCOUNT_APPROVED', null, RIDER, null, opened, 'approval:one']);
  const notices = await client.query(
    `SELECT "event_type", "dedupe_key" FROM "v2_outbox_events"
      WHERE "dedupe_key" IN ('bid:one:BID_RECEIVED', 'opportunity:one', 'approval:one')
      ORDER BY "dedupe_key"`,
  );
  expect(notices.rows).toEqual([
    { event_type: 'ACCOUNT_APPROVED', dedupe_key: 'approval:one' },
    { event_type: 'BID_RECEIVED', dedupe_key: 'bid:one:BID_RECEIVED' },
    { event_type: 'RIDER_OPPORTUNITY', dedupe_key: 'opportunity:one' },
  ]);
  await expect(client.query(NEXT_NOTICE, [
    'RIDER_OPPORTUNITY', DELIVERY, null, CUSTOMER, opened, 'opportunity:customer',
  ])).rejects.toMatchObject({ code: '23514' });

  await client.query(
    `INSERT INTO "v2_outbox_events" (
       "id", "event_type", "status", "delivery_id", "assignment_id", "rider_profile_id", "attempt_count"
     ) VALUES (gen_random_uuid(), 'BID_ACCEPTED', 'PENDING', $1, $2, $3, 0)`,
    [LATE_DELIVERY, LATE_ASSIGNMENT, RIDER],
  );
  const rolledBack = await client.query(
    `SELECT "dedupe_key" FROM "v2_outbox_events"
      WHERE "assignment_id" = $1 AND "event_type" = 'BID_ACCEPTED'`,
    [LATE_ASSIGNMENT],
  );
  expect(rolledBack.rows).toEqual([{ dedupe_key: `assignment:${LATE_ASSIGNMENT}:BID_ACCEPTED` }]);
});

const PREVIOUS_SCHEMA = `
CREATE TYPE "delivery_status" AS ENUM (
  'CREATED', 'RIDER_ASSIGNED', 'COLLECTING', 'COLLECTED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'
);
CREATE TYPE "assignment_status" AS ENUM ('ACCEPTED', 'RELEASED');
CREATE TYPE "v2_outbox_event_type" AS ENUM (
  'BID_ACCEPTED', 'REQUEST_REOPENED', 'COLLECTING', 'COLLECTED',
  'OUT_FOR_DELIVERY', 'DELIVERED', 'DEADLINE_REMINDER'
);
CREATE TYPE "v2_outbox_status" AS ENUM ('PENDING', 'SENT', 'FAILED');
CREATE TABLE "deliveries" (
  "id" UUID PRIMARY KEY,
  "customer_id" UUID NOT NULL,
  "deliver_by" TIMESTAMPTZ(6),
  "status" "delivery_status" NOT NULL
);
CREATE TABLE "delivery_assignments" (
  "id" UUID PRIMARY KEY,
  "delivery_id" UUID NOT NULL,
  "status" "assignment_status" NOT NULL,
  "accepted_bid_amount" NUMERIC
);
CREATE TABLE "v2_outbox_events" (
  "id" UUID PRIMARY KEY,
  "event_type" "v2_outbox_event_type" NOT NULL,
  "status" "v2_outbox_status" NOT NULL DEFAULT 'PENDING',
  "delivery_id" UUID NOT NULL,
  "assignment_id" UUID NOT NULL,
  "rider_profile_id" UUID,
  "customer_account_id" UUID,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "v2_outbox_events_recipient_chk" CHECK (
    "attempt_count" >= 0
    AND (
      (
        "event_type" = 'BID_ACCEPTED'::"v2_outbox_event_type"
        AND "rider_profile_id" IS NOT NULL
        AND "customer_account_id" IS NULL
      )
      OR (
        "event_type" <> 'BID_ACCEPTED'::"v2_outbox_event_type"
        AND "customer_account_id" IS NOT NULL
        AND "rider_profile_id" IS NULL
      )
    )
  )
);
CREATE UNIQUE INDEX "v2_outbox_events_assignment_id_event_type_key"
  ON "v2_outbox_events"("assignment_id", "event_type");
`;

async function applyFile(name: string) {
  const sql = readFileSync(new URL(`${name}/migration.sql`, MIGRATIONS), 'utf8');
  await client.query('BEGIN');
  try {
    for (const statement of sqlStatements(sql)) {
      await client.query(statement);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
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
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const next = new pg.Client({ connectionString: DISPOSABLE_URL, connectionTimeoutMillis: 1000 });
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
  throw lastError;
}
