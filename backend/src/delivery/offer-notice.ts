export const OFFER_NOTICE_BATCH = 10;

export const OFFER_NOTICE_DISCOVERY_SQL = `INSERT INTO rider_offer_notifications (
  id, assignment_id, rider_profile_id, status, attempt_count, next_attempt_at, created_at
)
SELECT gen_random_uuid(),
       candidate.id,
       candidate.rider_profile_id,
       'PENDING'::rider_offer_notification_status,
       0,
       $1,
       $1
FROM (
  -- delivery_assignments_offer_expires_at_idx serves offer_expires_at > $1.
  SELECT a.id, a.rider_profile_id
  FROM delivery_assignments a
  INNER JOIN deliveries d ON d.id = a.delivery_id
  WHERE a.offer_expires_at > $1
    AND a.status = 'OFFERED'::assignment_status
    AND d.status = 'SEARCHING'::delivery_status
    AND NOT EXISTS (
      SELECT 1
      FROM rider_offer_notifications n
      WHERE n.assignment_id = a.id
    )
  ORDER BY a.offer_expires_at
  LIMIT $2
) AS candidate
ON CONFLICT (assignment_id) DO NOTHING`;
export const OFFER_NOTICE_HTTP_TIMEOUT_MS = 3_000;
export const OFFER_NOTICE_RETRY_MS = 2_000;
export const OFFER_NOTICE_MAX_ATTEMPTS = 3;
export const OFFER_NOTICE_CLAIM_STALE_MS = 10_000;
export const OFFER_NOTICE_TTL_CAP_SECONDS = 60;

export type OfferNoticeSkipReason =
  | 'expired'
  | 'not_offered'
  | 'rider_offline'
  | 'firebase_unconfigured'
  | 'firebase_unavailable'
  | 'invalid_token'
  | 'no_device';

export type OfferNoticeSnapshot = {
  assignmentStatus: string;
  deliveryStatus: string;
  availability: string;
  offerExpiresAt: Date;
  attemptCount: number;
  lastFailure: string | null;
};

export type OfferNoticeDecision =
  | { action: 'send' }
  | { action: 'defer'; nextAttemptAt: Date; failure: 'firebase_unconfigured' | 'firebase_unavailable' }
  | { action: 'skip'; reason: OfferNoticeSkipReason };

export function androidTtlSeconds(offerExpiresAt: Date, now: Date): number {
  const remaining = Math.floor((offerExpiresAt.getTime() - now.getTime()) / 1_000);
  if (remaining <= 0) {
    return 0;
  }
  return Math.min(OFFER_NOTICE_TTL_CAP_SECONDS, remaining);
}

export function decideBeforeSend(
  snapshot: OfferNoticeSnapshot,
  now: Date,
  firebaseConfigured: boolean,
): OfferNoticeDecision {
  const remaining = snapshot.offerExpiresAt.getTime() - now.getTime();
  const stillOffered = snapshot.assignmentStatus === 'OFFERED'
    && snapshot.deliveryStatus === 'SEARCHING';
  if (!stillOffered) {
    return { action: 'skip', reason: 'not_offered' };
  }
  if (remaining <= OFFER_NOTICE_HTTP_TIMEOUT_MS) {
    if (snapshot.lastFailure === 'firebase_unconfigured') {
      return { action: 'skip', reason: 'firebase_unconfigured' };
    }
    return { action: 'skip', reason: 'expired' };
  }
  if (snapshot.availability !== 'AVAILABLE') {
    return { action: 'skip', reason: 'rider_offline' };
  }
  if (snapshot.attemptCount >= OFFER_NOTICE_MAX_ATTEMPTS) {
    return { action: 'skip', reason: 'firebase_unavailable' };
  }
  if (!firebaseConfigured) {
    return {
      action: 'defer',
      nextAttemptAt: snapshot.offerExpiresAt,
      failure: 'firebase_unconfigured',
    };
  }
  return { action: 'send' };
}

export function decideAfterTemporaryFailure(
  attemptCount: number,
  offerExpiresAt: Date,
  now: Date,
): OfferNoticeDecision {
  const attempts = attemptCount + 1;
  const nextAttemptAt = new Date(Math.min(
    now.getTime() + OFFER_NOTICE_RETRY_MS,
    offerExpiresAt.getTime(),
  ));
  if (attempts >= OFFER_NOTICE_MAX_ATTEMPTS) {
    return { action: 'skip', reason: 'firebase_unavailable' };
  }
  return { action: 'defer', nextAttemptAt, failure: 'firebase_unavailable' };
}
