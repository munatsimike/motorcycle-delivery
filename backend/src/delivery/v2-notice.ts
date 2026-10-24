import { V2OutboxEventType } from '../generated/prisma/client.js';

// Push delivery is at-least-once. If the provider accepts a message and the
// worker stops before the SENT update commits, the claim lease expires and
// another worker can send that message again. Exactly-once push delivery is
// not guaranteed.
export const V2_NOTICE_BATCH = 10;
export const V2_NOTICE_PROVIDER_TIMEOUT_MS = 3_000;
export const V2_NOTICE_CLAIM_LEASE_MS = 30_000;
export const V2_NOTICE_CLAIM_STALE_MS = V2_NOTICE_CLAIM_LEASE_MS;
export const V2_NOTICE_MAX_ATTEMPTS = 5;
export const V2_NOTICE_BASE_RETRY_MS = 2_000;
export const V2_NOTICE_MAX_RETRY_MS = 15 * 60_000;
export const V2_NOTICE_IDLE_MS = 60_000;

// One token request plus one send, with room for the claim to outlive both.
const PROVIDER_HOPS = 2;
const LEASE_MARGIN = 4;

export const V2_PUSH_TYPE: Record<V2OutboxEventType, string> = {
  BID_ACCEPTED: 'v2_bid_accepted',
  REQUEST_REOPENED: 'v2_request_reopened',
  COLLECTING: 'v2_collecting',
  COLLECTED: 'v2_collected',
  OUT_FOR_DELIVERY: 'v2_out_for_delivery',
  DELIVERED: 'v2_delivered',
  DEADLINE_REMINDER: 'v2_deadline_reminder',
};

export type V2NoticeConfig = {
  timeoutMs: number;
  leaseMs: number;
  maxAttempts: number;
};

export function v2NoticeConfig(env: NodeJS.ProcessEnv = process.env): V2NoticeConfig {
  const timeoutMs = integerInRange(
    env.V2_NOTICE_PROVIDER_TIMEOUT_MS,
    V2_NOTICE_PROVIDER_TIMEOUT_MS,
    500,
    10_000,
  );
  const minimumLeaseMs = timeoutMs * PROVIDER_HOPS * LEASE_MARGIN;
  const requestedLeaseMs = integerInRange(
    env.V2_NOTICE_CLAIM_LEASE_MS,
    V2_NOTICE_CLAIM_LEASE_MS,
    1_000,
    30 * 60_000,
  );
  return {
    timeoutMs,
    leaseMs: Math.max(requestedLeaseMs, minimumLeaseMs),
    maxAttempts: integerInRange(env.V2_NOTICE_MAX_ATTEMPTS, V2_NOTICE_MAX_ATTEMPTS, 1, 20),
  };
}

export function v2RetryAt(attemptCount: number, now: Date): Date {
  const exponent = Math.min(Math.max(attemptCount - 1, 0), 10);
  const delay = Math.min(V2_NOTICE_MAX_RETRY_MS, V2_NOTICE_BASE_RETRY_MS * (2 ** exponent));
  return new Date(now.getTime() + delay);
}

function integerInRange(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw == null || raw.trim() === '') {
    return clamp(fallback, min, max);
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    return clamp(fallback, min, max);
  }
  return clamp(parsed, min, max);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
