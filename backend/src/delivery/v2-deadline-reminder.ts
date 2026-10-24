import { v2MarketplaceEnabled } from '../auth/v2-flags.js';

type ReminderDb = {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
};

// One customer reminder for an accepted V2 parcel that is still active after
// deliverBy. The unique (assignment, event type) key makes a second writer a
// no-op. This statement does not cancel the delivery, release a reservation,
// or post a ledger entry.
const REMINDER_SQL = `INSERT INTO "v2_outbox_events" (
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

export async function remindLateV2Deliveries(db: ReminderDb, now: Date): Promise<number> {
  if (!v2MarketplaceEnabled()) {
    return 0;
  }
  return Number(await db.$executeRawUnsafe(REMINDER_SQL, now));
}
