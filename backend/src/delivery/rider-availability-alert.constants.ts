export const RIDER_ALERT_TTL_MS = 30 * 60 * 1000;
export const RIDER_ALERT_POLL_MS = 20_000;
export const RIDER_ALERT_CLAIM_LIMIT = 20;
export const RIDER_ALERT_STALE_CLAIM_MS = 2 * 60 * 1000;
export const RIDER_ALERT_PUSH_BACKOFF_CAP_MS = 5 * 60 * 1000;

export const RIDER_ALERT_PUSH = {
  title: 'A rider is available',
  body: 'A rider is available near you.',
  channelId: 'rider-availability',
  data: { kind: 'rider-availability' },
} as const;

export function riderAlertExpiresAt(now: Date): Date {
  return new Date(now.getTime() + RIDER_ALERT_TTL_MS);
}

export function nextRiderAlertAttempt(now: Date, attemptCount: number): Date {
  const delay = Math.min(RIDER_ALERT_PUSH_BACKOFF_CAP_MS, 30_000 * Math.max(1, attemptCount));
  return new Date(now.getTime() + delay);
}
