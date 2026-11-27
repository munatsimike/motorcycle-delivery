import { Prisma } from '../generated/prisma/client.js';
import type { ListCursor } from './list-cursor.js';

export type ExactPageKey = { id: string; at: string };
export type PageSource = 'completed' | 'deliveries' | 'addresses' | 'wallet' | 'bids';
export type HistoryStatus = 'ALL' | 'DELIVERED' | 'CANCELLED';

// Only fixed, application-owned SQL fragments are interpolated as identifiers.
// PostgreSQL compares the original timestamp, not a JavaScript Date.
export async function exactPageKeys(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  source: PageSource,
  owner: string,
  limit: number,
  cursor?: ListCursor,
  statuses?: readonly string[],
): Promise<ExactPageKey[]> {
  const sources = {
    completed: { table: Prisma.sql`delivery_assignments t`, owner: Prisma.sql`t.rider_profile_id`, time: Prisma.sql`t.completed_at`, extra: Prisma.sql`AND t.status = 'COMPLETED' AND t.completed_at IS NOT NULL AND EXISTS (SELECT 1 FROM deliveries d WHERE d.id = t.delivery_id AND d.status = 'DELIVERED')` },
    deliveries: { table: Prisma.sql`deliveries t`, owner: Prisma.sql`t.customer_id`, time: Prisma.sql`t.created_at`, extra: statuses?.length ? Prisma.sql`AND t.status IN (${Prisma.join(statuses.map(status => Prisma.sql`${status}::delivery_status`))})` : Prisma.empty },
    addresses: { table: Prisma.sql`customer_saved_addresses t`, owner: Prisma.sql`t.customer_account_id`, time: Prisma.sql`t.created_at`, extra: Prisma.empty },
    wallet: { table: Prisma.sql`rider_wallet_entries t`, owner: Prisma.sql`t.rider_wallet_id`, time: Prisma.sql`t.created_at`, extra: Prisma.empty },
    bids: { table: Prisma.sql`bids t`, owner: Prisma.sql`t.rider_profile_id`, time: Prisma.sql`t.created_at`, extra: Prisma.empty },
  };
  const { table, owner: ownerColumn, time, extra } = sources[source];
  const ascending = source === 'addresses';
  const direction = ascending ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const op = ascending ? Prisma.sql`>` : Prisma.sql`<`;
  const boundary = cursor ? Prisma.sql`AND (${time}, t.id) ${op} (${cursor.exact ?? cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)` : Prisma.empty;
  return db.$queryRaw<ExactPageKey[]>(Prisma.sql`
    SELECT t.id::text AS id, to_char(${time} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
    FROM ${table}
    WHERE ${ownerColumn} = ${owner}::uuid ${extra} ${boundary}
    ORDER BY ${time} ${direction}, t.id ${direction}
    LIMIT ${limit + 1}
  `);
}

// Status is applied inside each indexed branch, before the shared cursor and limit.
// A later rider completing the same delivery does not remove the released row.
export async function historyPageKeys(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  owner: string,
  limit: number,
  cursor: ListCursor | undefined,
  outcome: HistoryStatus,
): Promise<ExactPageKey[]> {
  const boundary = cursor
    ? Prisma.sql`WHERE (history.history_at, history.id) < (${cursor.exact ?? cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)`
    : Prisma.empty;
  return db.$queryRaw<ExactPageKey[]>(Prisma.sql`
    SELECT history.id::text AS id, to_char(history.history_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
    FROM (
      SELECT t.id, t.completed_at AS history_at
      FROM delivery_assignments t
      WHERE t.rider_profile_id = ${owner}::uuid
        AND t.status = 'COMPLETED'
        AND t.completed_at IS NOT NULL
        AND ${outcome}::text IN ('ALL', 'DELIVERED')
      UNION ALL
      SELECT t.id, t.released_at AS history_at
      FROM delivery_assignments t
      WHERE t.rider_profile_id = ${owner}::uuid
        AND t.status = 'RELEASED'
        AND t.released_at IS NOT NULL
        AND ${outcome}::text IN ('ALL', 'CANCELLED')
    ) history
    ${boundary}
    ORDER BY history.history_at DESC, history.id DESC
    LIMIT ${limit + 1}
  `);
}

export function orderedPageRows<T extends { id: string }>(keys: ExactPageKey[], rows: T[]): T[] {
  const byId = new Map(rows.map(row => [row.id, row]));
  return keys.flatMap(key => { const row = byId.get(key.id); return row ? [row] : []; });
}
