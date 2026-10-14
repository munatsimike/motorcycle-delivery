import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountStatus, UserRole } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AccessTokenService } from '../auth/access-token.service.js';
import { AdminAccessGuard } from '../auth/admin-access.guard.js';
import { AdminAccessService } from '../auth/admin-access.service.js';
import { RiderAdminController } from './rider-admin.controller.js';

const SECRET = '0123456789abcdef0123456789abcdef';

describe('admin wallet top-up authorization', () => {
  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.JWT_ACCESS_SECRET;
  });

  it('rejects rider and customer tokens before crediting a wallet', async () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, RiderAdminController)).toEqual([AdminAccessGuard]);
    const ctx = access();
    let credited = false;
    const controller = new RiderAdminController({} as never, {} as never, {
      async topUp() {
        credited = true;
        return {};
      },
    } as never);
    const guard = new AdminAccessGuard(ctx.service);

    await expect(guard.canActivate(http({ headers: { authorization: ctx.token(UserRole.RIDER) } })))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(http({ headers: { authorization: ctx.token(UserRole.CUSTOMER) } })))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(() => controller.topUp({}, 'profile-1', { amount: '2.00' })).toThrow(ForbiddenException);
    expect(credited).toBe(false);
  });
});

function http(request: object): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
}

function access() {
  const now = new Date();
  const session = {
    id: 'session-1',
    userId: 'admin-1',
    revokedAt: null,
    replacedBySessionId: null,
    expiresAt: new Date(now.getTime() + 60_000),
  };
  const user = { id: 'admin-1', role: UserRole.ADMIN, accountStatus: AccountStatus.ACTIVE };
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
  const tokens = new AccessTokenService();
  return {
    service: new AdminAccessService(db as unknown as PrismaService, tokens),
    token(role: UserRole) {
      return `Bearer ${tokens.sign({ sub: user.id, role, sid: session.id }, now).token}`;
    },
  };
}
