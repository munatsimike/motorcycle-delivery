import { V2OutboxEventType } from '../generated/prisma/client.js';
import { V2_NOTICE_IDLE_MS, V2_PUSH_TYPE } from './v2-notice.js';

const OPPORTUNITY_TTL_SECONDS = 5 * 60;
const CUSTOMER_TTL_SECONDS = 60 * 60;
const APPROVAL_TTL_SECONDS = 24 * 60 * 60;

export type MarketplaceNoticeKind = 'BID_RECEIVED' | 'COUNTEROFFER' | 'RIDER_OPPORTUNITY' | 'ACCOUNT_APPROVED';

export type OpportunityRider = {
  approvalStatus: string;
  accountStatus: string;
  phoneVerified: boolean;
  licenceVerified: boolean;
  receivingRequests: boolean;
  activeVerifiedMotorcycle: boolean;
  availability: string;
};

export type NoticeDisposition = 'sent' | 'retry' | 'terminal' | 'defer';

type NoticeExecutor = {
  $executeRawUnsafe?(query: string, ...values: unknown[]): Promise<unknown>;
};

const INSERT_NOTICE = `INSERT INTO "v2_outbox_events" (
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

export function customerBidNoticeType(amountCents: number, offeredCents: number): 'BID_RECEIVED' | 'COUNTEROFFER' {
  return amountCents === offeredCents ? 'BID_RECEIVED' : 'COUNTEROFFER';
}

export function assignmentNoticeDedupe(assignmentId: string, eventType: string): string {
  return `assignment:${assignmentId}:${eventType}`;
}

export function bidNoticeDedupe(bidId: string, eventType: 'BID_RECEIVED' | 'COUNTEROFFER'): string {
  return `bid:${bidId}:${eventType}`;
}

export function opportunityDedupe(deliveryId: string, openedAt: Date): string {
  return `opportunity:${deliveryId}:${openedAt.toISOString()}`;
}

export function approvalDedupe(riderProfileId: string, approvedAt: Date): string {
  return `approval:${riderProfileId}:${approvedAt.toISOString()}`;
}

export function mayReceiveDeliveryOpportunity(rider: OpportunityRider): boolean {
  return rider.approvalStatus === 'APPROVED'
    && rider.accountStatus === 'ACTIVE'
    && rider.phoneVerified
    && rider.licenceVerified
    && rider.receivingRequests
    && rider.activeVerifiedMotorcycle
    && rider.availability !== 'OFFLINE';
}

export function hasActiveVerifiedMotorcycle(motorcycles: ReadonlyArray<{ isActive: boolean; verificationStatus: string }>): boolean {
  const active = motorcycles.filter((motorcycle) => motorcycle.isActive);
  return active.length === 1 && active[0]?.verificationStatus === 'VERIFIED';
}

export function v2PushTtlSeconds(type: string): number {
  if (type === 'rider_offer') {
    return OPPORTUNITY_TTL_SECONDS;
  }
  if (type === 'rider_account_approved') {
    return APPROVAL_TTL_SECONDS;
  }
  if (type in {
    v2_bid_received: true,
    v2_counteroffer: true,
    v2_bid_accepted: true,
    v2_request_reopened: true,
    v2_deadline_reminder: true,
    v2_collecting: true,
    v2_collected: true,
    v2_out_for_delivery: true,
    v2_delivered: true,
  }) {
    return CUSTOMER_TTL_SECONDS;
  }
  return 60;
}

export function v2PushAudience(eventType: string): 'customer' | 'rider' {
  if (eventType === 'BID_ACCEPTED' || eventType === 'RIDER_OPPORTUNITY' || eventType === 'ACCOUNT_APPROVED') {
    return 'rider';
  }
  return 'customer';
}

export function v2PushCollapseKey(type: string, deliveryId: string | null): string {
  return `${type}:${deliveryId ?? 'account'}`.slice(0, 64);
}

export function v2PushType(eventType: string): string | null {
  return V2_PUSH_TYPE[eventType as keyof typeof V2_PUSH_TYPE] ?? null;
}

export function noticeDisposition(input: {
  configured: boolean;
  knownType: boolean;
  deviceCount: number;
  outcomes: Array<'accepted' | 'invalid' | 'temporary' | 'timeout'>;
}): { disposition: NoticeDisposition; failure: 'provider_timeout' | 'provider_unavailable' | null } {
  if (!input.configured || !input.knownType || input.deviceCount === 0) {
    return { disposition: 'defer', failure: null };
  }
  if (input.outcomes.includes('accepted')) {
    return { disposition: 'sent', failure: null };
  }
  if (input.outcomes.includes('timeout')) {
    return { disposition: 'retry', failure: 'provider_timeout' };
  }
  if (input.outcomes.includes('temporary')) {
    return { disposition: 'retry', failure: 'provider_unavailable' };
  }
  return { disposition: 'defer', failure: null };
}

export function tokenlessDeferAt(now: Date): Date {
  return new Date(now.getTime() + V2_NOTICE_IDLE_MS);
}

export async function insertMarketplaceNotice(
  tx: NoticeExecutor,
  input: {
    eventType: MarketplaceNoticeKind;
    deliveryId: string | null;
    riderProfileId: string | null;
    customerAccountId: string | null;
    createdAt: Date;
    dedupeKey: string;
  },
): Promise<void> {
  if (typeof tx.$executeRawUnsafe !== 'function') {
    return;
  }
  const run = tx.$executeRawUnsafe.bind(tx);
  try {
    await run('SAVEPOINT riders_notice');
  } catch {
    return;
  }
  try {
    await run(
      INSERT_NOTICE,
      V2OutboxEventType[input.eventType],
      input.deliveryId,
      input.riderProfileId,
      input.customerAccountId,
      input.createdAt,
      input.dedupeKey,
    );
    await run('RELEASE SAVEPOINT riders_notice');
  } catch {
    try {
      await run('ROLLBACK TO SAVEPOINT riders_notice');
    } catch {
      // The business transaction keeps its own outcome.
    }
  }
}
