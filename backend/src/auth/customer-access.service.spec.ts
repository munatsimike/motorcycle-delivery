import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountStatus, UserRole } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AccessTokenService } from './access-token.service.js';
import { CustomerAccessService } from './customer-access.service.js';

const SECRET = '0123456789abcdef0123456789abcdef';
const NOW = new Date('2026-10-13T12:00:00.000Z');

describe('CustomerAccessService', () => {
  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.JWT_ACCESS_SECRET;
  });

  it('allows a rider session only after that rider has a customer account', async () => {
    const ctx = context(UserRole.RIDER);
    await expect(ctx.service.authenticate(ctx.token(), NOW)).resolves.toEqual({ userId: 'user-1', role: UserRole.RIDER });
    await expect(ctx.service.authenticateAccount(ctx.token(), NOW)).rejects.toBeInstanceOf(ForbiddenException);

    ctx.user.customerAccount = { id: 'account-1' };
    await expect(ctx.service.authenticateAccount(ctx.token(), NOW)).resolves.toEqual({
      userId: 'user-1',
      role: UserRole.RIDER,
      customerAccountId: 'account-1',
    });
  });

  it('binds each private test customer to that customer account only', async () => {
    const accessTokens = new AccessTokenService();
    const users = [
      { id: 'user-a', role: UserRole.CUSTOMER, accountStatus: AccountStatus.ACTIVE, phoneVerifiedAt: NOW, customerAccount: { id: 'account-a' } },
      { id: 'user-b', role: UserRole.CUSTOMER, accountStatus: AccountStatus.ACTIVE, phoneVerifiedAt: NOW, customerAccount: { id: 'account-b' } },
    ];
    const sessions = [
      { id: 'session-a', userId: 'user-a', revokedAt: null, replacedBySessionId: null, expiresAt: new Date(NOW.getTime() + 60_000) },
      { id: 'session-b', userId: 'user-b', revokedAt: null, replacedBySessionId: null, expiresAt: new Date(NOW.getTime() + 60_000) },
    ];
    const db = {
      refreshSession: {
        async findUnique({ where }: { where: { id: string } }) {
          return sessions.find((session) => session.id === where.id) ?? null;
        },
      },
      user: {
        async findUnique({ where }: { where: { id: string } }) {
          return users.find((user) => user.id === where.id) ?? null;
        },
      },
    };
    const service = new CustomerAccessService(db as unknown as PrismaService, accessTokens);
    const tokenA = `Bearer ${accessTokens.sign({ sub: 'user-a', role: UserRole.CUSTOMER, sid: 'session-a' }, NOW).token}`;
    const tokenB = `Bearer ${accessTokens.sign({ sub: 'user-b', role: UserRole.CUSTOMER, sid: 'session-b' }, NOW).token}`;
    await expect(service.authenticateAccount(tokenA, NOW)).resolves.toMatchObject({ userId: 'user-a', customerAccountId: 'account-a' });
    await expect(service.authenticateAccount(tokenB, NOW)).resolves.toMatchObject({ userId: 'user-b', customerAccountId: 'account-b' });
  });

  it('rejects an admin and a customer token whose stored role does not match', async () => {
    const admin = context(UserRole.ADMIN);
    await expect(admin.service.authenticate(admin.token(), NOW)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(admin.service.authenticateAccount(admin.token(), NOW)).rejects.toBeInstanceOf(ForbiddenException);

    const mismatched = context(UserRole.RIDER);
    mismatched.user.role = UserRole.CUSTOMER;
    await expect(mismatched.service.authenticate(mismatched.token(), NOW)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

function context(role: UserRole) {
  const user = {
    id: 'user-1',
    role,
    accountStatus: AccountStatus.ACTIVE,
    phoneVerifiedAt: NOW,
    customerAccount: null as { id: string } | null,
  };
  const session = {
    id: 'session-1',
    userId: 'user-1',
    revokedAt: null,
    replacedBySessionId: null,
    expiresAt: new Date(NOW.getTime() + 60_000),
  };
  const db = {
    refreshSession: {
      async findUnique({ where }: { where: { id: string } }) {
        return session.id === where.id ? session : null;
      },
    },
    user: {
      async findUnique() {
        return user;
      },
    },
  };
  const accessTokens = new AccessTokenService();
  return {
    service: new CustomerAccessService(db as unknown as PrismaService, accessTokens),
    user,
    token() {
      return `Bearer ${accessTokens.sign({ sub: 'user-1', role, sid: 'session-1' }, NOW).token}`;
    },
  };
}
