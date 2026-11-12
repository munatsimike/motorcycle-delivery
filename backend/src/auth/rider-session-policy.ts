import { UnauthorizedException } from '@nestjs/common';
import { UserRole } from '../generated/prisma/client.js';

export const RIDER_SIGNED_IN_ELSEWHERE =
  'Your account was signed in on another device. Please sign in again to continue.';

type SessionIdentity = {
  id: string;
  userId: string;
  revokedAt: Date | null;
  replacedBySessionId: string | null;
};

type SessionLookup = {
  user: {
    findUnique(args: {
      where: { id: string };
      include?: { riderProfile: { select: { id: true } } };
    }): Promise<{ role: UserRole; riderProfile?: { id: string } | null } | null>;
  };
  refreshSession: {
    findFirst(args: {
      where: { userId: string; revokedAt: null; id: { not: string } };
    }): Promise<{ id: string } | null>;
  };
};

export async function riderSignedInElsewhere(
  db: SessionLookup,
  session: SessionIdentity | null,
): Promise<boolean> {
  if (!session || session.revokedAt === null || session.replacedBySessionId !== null) {
    return false;
  }
  const user = await db.user.findUnique({
    where: { id: session.userId },
    include: { riderProfile: { select: { id: true } } },
  });
  if (!user || (user.role !== UserRole.RIDER && !user.riderProfile)) {
    return false;
  }
  const active = await db.refreshSession.findFirst({
    where: { userId: session.userId, revokedAt: null, id: { not: session.id } },
  });
  return active !== null;
}

export async function rejectClosedRiderSession(
  db: SessionLookup,
  session: SessionIdentity | null,
): Promise<never> {
  if (await riderSignedInElsewhere(db, session)) {
    throw new UnauthorizedException(RIDER_SIGNED_IN_ELSEWHERE);
  }
  throw new UnauthorizedException('Authentication failed');
}
