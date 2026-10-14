import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountStatus, UserRole } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AccessTokenService } from './access-token.service.js';
import { AdminAccessService } from './admin-access.service.js';

const SECRET = '0123456789abcdef0123456789abcdef';
const NOW = new Date('2026-10-13T12:00:00.000Z');

describe('AdminAccessService', () => {
  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.JWT_ACCESS_SECRET;
  });

  it('allows an active admin with a live session', async () => {
    const ctx = context();
    await expect(ctx.service.authenticate(ctx.token(), NOW)).resolves.toEqual({ userId: 'admin-1' });
  });

  it('rejects a rider and a missing, revoked, or inactive admin session', async () => {
    const rider = context();
    await expect(rider.service.authenticate(rider.token(UserRole.RIDER), NOW)).rejects.toBeInstanceOf(ForbiddenException);

    const customer = context();
    await expect(customer.service.authenticate(customer.token(UserRole.CUSTOMER), NOW)).rejects.toBeInstanceOf(ForbiddenException);

    const missing = context();
    await expect(missing.service.authenticate(undefined, NOW)).rejects.toBeInstanceOf(UnauthorizedException);

    const revoked = context();
    revoked.session.revokedAt = NOW;
    await expect(revoked.service.authenticate(revoked.token(), NOW)).rejects.toBeInstanceOf(UnauthorizedException);

    const suspended = context();
    suspended.user.accountStatus = AccountStatus.SUSPENDED;
    await expect(suspended.service.authenticate(suspended.token(), NOW)).rejects.toBeInstanceOf(ForbiddenException);

    const replaced = context();
    replaced.session.replacedBySessionId = 'session-2';
    await expect(replaced.service.authenticate(replaced.token(), NOW)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

type SessionRow = {
  id: string;
  userId: string;
  revokedAt: Date | null;
  replacedBySessionId: string | null;
  expiresAt: Date;
};

function context() {
  const session: SessionRow = {
    id: 'session-1',
    userId: 'admin-1',
    revokedAt: null,
    replacedBySessionId: null,
    expiresAt: new Date(NOW.getTime() + 60_000),
  };
  const user = {
    id: 'admin-1',
    role: UserRole.ADMIN,
    accountStatus: AccountStatus.ACTIVE,
  };
  const db = {
    refreshSession: {
      async findUnique({ where }: { where: { id: string } }) {
        return session.id === where.id ? session : null;
      },
    },
    user: {
      async findUnique({ where }: { where: { id: string } }) {
        return user.id === where.id ? user : null;
      },
    },
  };
  const accessTokens = new AccessTokenService();
  return {
    service: new AdminAccessService(db as unknown as PrismaService, accessTokens),
    session,
    user,
    token(role = UserRole.ADMIN) {
      return `Bearer ${accessTokens.sign({ sub: user.id, role, sid: session.id }, NOW).token}`;
    },
  };
}
