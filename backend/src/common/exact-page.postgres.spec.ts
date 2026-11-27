import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '../generated/prisma/client.js';
import { exactPageKeys, historyPageKeys, type PageSource } from './exact-page.js';
import { encodeListCursor, readKeysetCursor } from './list-cursor.js';

const exec = promisify(execFile);
const container = `riders-exact-page-${process.pid}`;
const owner = '00000000-0000-7000-8000-000000000001';
const foreign = '00000000-0000-7000-8000-000000000002';
const ids = [1, 2, 3, 4, 5].map(n => `00000000-0000-7000-8000-${String(n + 100).padStart(12, '0')}`);
const times = ['2026-11-26T19:30:15.123001Z', '2026-11-26T19:30:15.123456Z', '2026-11-26T19:30:15.123456Z', '2026-11-26T19:30:15.123999Z', '2026-11-26T19:30:15.123999Z'];
let client: pg.Client;
let started = false;
const db = { $queryRaw: async (sql: Prisma.Sql) => (await client.query(sql.text, sql.values)).rows } as unknown as Pick<Prisma.TransactionClient, '$queryRaw'>;

beforeAll(async () => {
  // Always create a disposable database; never use DATABASE_URL.
  await exec('docker', ['run', '-d', '--name', container, '-p', '127.0.0.1::5432', '-e', 'POSTGRES_PASSWORD=postgres', 'postgres:17-alpine']);
  started = true;
  const { stdout } = await exec('docker', ['port', container, '5432/tcp']);
  const port = Number(stdout.trim().split(':').pop());
  if (!Number.isInteger(port) || port < 1) throw new Error('Invalid disposable PostgreSQL port');
  for (let attempt = 0; attempt < 120; attempt++) {
    const candidate = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres', connectionTimeoutMillis: 1000 });
    candidate.on('error', () => undefined);
    try { await candidate.connect(); client = candidate; break; }
    catch { await candidate.end().catch(() => undefined); await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  if (!client) throw new Error('Disposable PostgreSQL did not start');
  await client.query(`CREATE TYPE delivery_status AS ENUM ('DELIVERED', 'CREATED');
    CREATE TEMP TABLE deliveries (id uuid PRIMARY KEY, customer_id uuid, created_at timestamptz(6), status delivery_status);
    CREATE TEMP TABLE delivery_assignments (id uuid PRIMARY KEY, rider_profile_id uuid, completed_at timestamptz(6), status text, delivery_id uuid, released_at timestamptz(6));
    CREATE TEMP TABLE customer_saved_addresses (id uuid PRIMARY KEY, customer_account_id uuid, created_at timestamptz(6));
    CREATE TEMP TABLE rider_wallet_entries (id uuid PRIMARY KEY, rider_wallet_id uuid, created_at timestamptz(6));
    CREATE TEMP TABLE bids (id uuid PRIMARY KEY, rider_profile_id uuid, created_at timestamptz(6));`);
  for (let i = 0; i < ids.length; i++) {
    const values = [ids[i], i === 4 ? foreign : owner, times[i]];
    await client.query("INSERT INTO deliveries VALUES ($1,$2,$3,'DELIVERED')", values);
    await client.query("INSERT INTO delivery_assignments (id, rider_profile_id, completed_at, status, delivery_id) VALUES ($1,$2,$3,'COMPLETED',$1)", values);
    for (const table of ['customer_saved_addresses', 'rider_wallet_entries', 'bids']) {
      await client.query(`INSERT INTO ${table} VALUES ($1,$2,$3)`, values);
    }
  }
}, 120_000);

afterAll(async () => {
  if (client) await client.end();
  if (started) await exec('docker', ['rm', '-f', container]);
}, 120_000);

describe('exact PostgreSQL keyset ordering', () => {
  const sources: Array<[PageSource, string]> = [['completed', 'delivery_assignments'], ['deliveries', 'deliveries'], ['addresses', 'customer_saved_addresses'], ['wallet', 'rider_wallet_entries'], ['bids', 'bids']];
  for (const [source, table] of sources) {
    it(`${source}: traverses microseconds, ties and deleted cursor rows without leaking another owner`, async () => {
      const expected = source === 'addresses' ? ids.slice(0, 4) : ids.slice(0, 4).reverse();
      const seen: string[] = [];
      let cursor: ReturnType<typeof readKeysetCursor> | undefined;
      await client.query('BEGIN');
      try {
        for (let step = 0; step < 5; step++) {
          const keys = await exactPageKeys(db, source, owner, 1, cursor);
          if (!keys.length) break;
          const key = keys[0]!;
          seen.push(key.id);
          expect(key.at).toBe(times[ids.indexOf(key.id)]);
          cursor = readKeysetCursor(encodeListCursor(key.at, key.id));
          await client.query(`DELETE FROM ${table} WHERE id = $1`, [key.id]);
        }
        expect(seen).toEqual(expected);
        expect(await exactPageKeys(db, source, foreign, 1)).toHaveLength(1);
      } finally { await client.query('ROLLBACK'); }
    });
  }
  it('filters rider history before the cursor page and keeps a released row', async () => {
    const released = '00000000-0000-7000-8000-000000000091';
    const releasedEarlier = '00000000-0000-7000-8000-000000000090';
    await client.query("INSERT INTO delivery_assignments (id, rider_profile_id, status, delivery_id, released_at) VALUES ($1,$2,'RELEASED',$1,$3)", [released, owner, '2026-11-26T20:00:00.000001Z']);
    await client.query("INSERT INTO delivery_assignments (id, rider_profile_id, status, delivery_id, released_at) VALUES ($1,$2,'RELEASED',$1,$3)", [releasedEarlier, foreign, '2026-11-26T21:00:00.000001Z']);
    const newest = await historyPageKeys(db, owner, 1, undefined, 'ALL');
    expect(newest[0]?.id).toBe(released);
    expect(newest.map(key => key.id)).not.toContain(releasedEarlier);
    const delivered = await historyPageKeys(db, owner, 1, undefined, 'DELIVERED');
    expect(delivered[0]?.id).toBe(ids[3]);
    expect(delivered.map(key => key.id)).not.toContain(released);
    const cancelled = await historyPageKeys(db, owner, 10, undefined, 'CANCELLED');
    expect(cancelled.map(key => key.id)).toEqual([released]);
    expect(await historyPageKeys(db, foreign, 10, undefined, 'CANCELLED')).toEqual([{ id: releasedEarlier, at: '2026-11-26T21:00:00.000001Z' }]);
    await client.query('DELETE FROM delivery_assignments WHERE id = ANY($1::uuid[])', [[released, releasedEarlier]]);
  });
  it('preserves customer status filters', async () => {
    expect(await exactPageKeys(db, 'deliveries', owner, 10, undefined, ['CREATED'])).toEqual([]);
    expect(await exactPageKeys(db, 'deliveries', owner, 10, undefined, ['DELIVERED'])).toHaveLength(4);
  });
});
