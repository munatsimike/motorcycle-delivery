import {
  ADMIN_OTP_MAX_REQUESTS_PER_HOUR,
  ADMIN_OTP_RESEND_COOLDOWN_MS,
} from './admin-login.constants.js';

type ChallengeTime = {
  createdAt: Date;
};

export function adminOtpRequestAllowed(
  recentChallenges: ChallengeTime[],
  now: Date,
): boolean {
  const hourAgo = now.getTime() - 60 * 60 * 1000;

  const withinHour = recentChallenges.filter(
    (challenge) => challenge.createdAt.getTime() >= hourAgo,
  );

  if (withinHour.length >= ADMIN_OTP_MAX_REQUESTS_PER_HOUR) {
    return false;
  }

  const latest = withinHour.reduce<Date | null>(
    (current, challenge) =>
      current === null || challenge.createdAt > current
        ? challenge.createdAt
        : current,
    null,
  );

  return (
    latest === null ||
    now.getTime() - latest.getTime() >= ADMIN_OTP_RESEND_COOLDOWN_MS
  );
}
