import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountStatus, UserRole } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AccessTokenService } from './access-token.service.js';
import { RiderAccessService } from './rider-access.service.js';

const SECRET = '0123456789abcdef0123456789abcdef';
const NOW = new Date('2026-10-13T12:00:00.000Z');

describe('RiderAccessService', () => {
  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.JWT_ACCESS_SECRET;
  });

  it('allows an active rider with a live session to upload only their own profile', async () => {
    const ctx = context();
    const token = ctx.token();
    await expect(ctx.service.authenticate(token, NOW)).resolves.toEqual({
      userId: 'user-1',
      riderProfileId: 'profile-1',
    });
  });

  it('rejects a missing, expired, revoked, replaced, or mismatched session', async () => {
    const missing = context();
    await expect(missing.service.authenticate(undefined, NOW)).rejects.toBeInstanceOf(UnauthorizedException);

    const expiredToken = context();
    const token = expiredToken.token(NOW);
    await expect(expiredToken.service.authenticate(token, new Date(NOW.getTime() + 16 * 60 * 1000)))
      .rejects.toBeInstanceOf(UnauthorizedException);

    const revoked = context();
    revoked.session.revokedAt = NOW;
    await expect(revoked.service.authenticate(revoked.token(), NOW)).rejects.toBeInstanceOf(UnauthorizedException);

    const replaced = context();
    replaced.session.replacedBySessionId = 'session-2';
    await expect(replaced.service.authenticate(replaced.token(), NOW)).rejects.toBeInstanceOf(UnauthorizedException);

    const expiredSession = context();
    expiredSession.session.expiresAt = new Date(NOW.getTime() - 1000);
    await expect(expiredSession.service.authenticate(expiredSession.token(), NOW)).rejects.toBeInstanceOf(UnauthorizedException);

    const mismatched = context();
    mismatched.session.userId = 'user-2';
    await expect(mismatched.service.authenticate(mismatched.token(), NOW)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects customers, suspended riders, and riders without a profile', async () => {
    const customer = context();
    await expect(customer.service.authenticate(customer.token(NOW, UserRole.CUSTOMER), NOW)).rejects.toBeInstanceOf(ForbiddenException);

    const suspended = context();
    suspended.user.accountStatus = AccountStatus.SUSPENDED;
    await expect(suspended.service.authenticate(suspended.token(), NOW)).rejects.toBeInstanceOf(ForbiddenException);

    const deactivated = context();
    deactivated.user.accountStatus = AccountStatus.DEACTIVATED;
    await expect(deactivated.service.authenticate(deactivated.token(), NOW)).rejects.toBeInstanceOf(ForbiddenException);

    const unverified = context();
    unverified.user.phoneVerifiedAt = null;
    await expect(unverified.service.authenticate(unverified.token(), NOW)).rejects.toBeInstanceOf(ForbiddenException);

    const noProfile = context();
    noProfile.profile = null;
    await expect(noProfile.service.authenticate(noProfile.token(), NOW)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

type SessionRow = {
  id: string;
  userId: string;
  revokedAt: Date | null;
  replacedBySessionId: string | null;
  expiresAt: Date;
};

type UserRow = {
  id: string;
  role: UserRole;
  accountStatus: AccountStatus;
  phoneVerifiedAt: Date | null;
};

type ProfileRow = { id: string; userId: string };

function context() {
  const session: SessionRow = {
    id: 'session-1',
    userId: 'user-1',
    revokedAt: null,
    replacedBySessionId: null,
    expiresAt: new Date(NOW.getTime() + 60_000),
  };
  const user: UserRow = {
    id: 'user-1',
    role: UserRole.RIDER,
    accountStatus: AccountStatus.ACTIVE,
    phoneVerifiedAt: NOW,
  };
  const state: { profile: ProfileRow | null } = { profile: { id: 'profile-1', userId: 'user-1' } };
  const db = {
    refreshSession: {
      async findUnique({ where }: { where: { id: string } }) {
        return session.id === where.id ? session : null;
      },
    },
    user: {
      async findUnique({ where }: { where: { id: string } }) {
        if (user.id !== where.id) {
          return null;
        }
        return { ...user, riderProfile: state.profile };
      },
    },
  };
  const accessTokens = new AccessTokenService();
  const service = new RiderAccessService(db as unknown as PrismaService, accessTokens);
  return {
    service,
    session,
    user,
    get profile() {
      return state.profile;
    },
    set profile(value: ProfileRow | null) {
      state.profile = value;
    },
    token(at = NOW, role = UserRole.RIDER) {
      return `Bearer ${accessTokens.sign({ sub: user.id, role, sid: session.id }, at).token}`;
    },
  };
}
