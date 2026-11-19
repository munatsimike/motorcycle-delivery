import { UnauthorizedException } from '@nestjs/common';
import { UserRole } from '../generated/prisma/client.js';

export const SIGNED_IN_ELSEWHERE =
  'Your account was signed in on another device. Please sign in again to continue.';

export const RIDER_SIGNED_IN_ELSEWHERE = SIGNED_IN_ELSEWHERE;

type SessionIdentity = {
  id: string;
  userId: string;
  appRole?: UserRole | null;
  revokedAt: Date | null;
  replacedBySessionId: string | null;
};

type SessionLookup = {
  refreshSession: {
    findFirst(args: {
      where: { userId: string; appRole: UserRole; revokedAt: null; id: { not: string } };
    }): Promise<{ id: string } | null>;
  };
};

export async function signedInElsewhere(
  db: SessionLookup,
  session: SessionIdentity | null,
): Promise<boolean> {
  if (!session || session.revokedAt === null || session.replacedBySessionId !== null) {
    return false;
  }
  if (session.appRole !== UserRole.CUSTOMER && session.appRole !== UserRole.RIDER) {
    return false;
  }
  const active = await db.refreshSession.findFirst({
    where: {
      userId: session.userId,
      appRole: session.appRole,
      revokedAt: null,
      id: { not: session.id },
    },
  });
  return active !== null;
}

export async function rejectClosedSession(
  db: SessionLookup,
  session: SessionIdentity | null,
): Promise<never> {
  if (await signedInElsewhere(db, session)) {
    throw new UnauthorizedException(SIGNED_IN_ELSEWHERE);
  }
  throw new UnauthorizedException('Authentication failed');
}

export const rejectClosedRiderSession = rejectClosedSession;
