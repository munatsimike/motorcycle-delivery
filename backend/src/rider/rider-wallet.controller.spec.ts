import { ExecutionContext, ForbiddenException, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountStatus, UserRole } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AccessTokenService } from '../auth/access-token.service.js';
import { RiderAccessGuard, type RiderRequest } from '../auth/rider-access.guard.js';
import { RiderAccessService } from '../auth/rider-access.service.js';
import { RiderWalletController } from './rider-wallet.controller.js';

const SECRET = '0123456789abcdef0123456789abcdef';

describe('rider wallet read authorization', () => {
  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.JWT_ACCESS_SECRET;
  });

  it('exposes only guarded read routes', () => {
    expect(Reflect.getMetadata(PATH_METADATA, RiderWalletController)).toBe('riders/me/wallet');
    expect(Reflect.getMetadata(GUARDS_METADATA, RiderWalletController)).toEqual([RiderAccessGuard]);
    expect(Reflect.getMetadata(METHOD_METADATA, RiderWalletController.prototype.summary)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(METHOD_METADATA, RiderWalletController.prototype.transactions)).toBe(RequestMethod.GET);
  });

  it('rejects customers and admins before reading a wallet', async () => {
    const ctx = access();
    let reads = 0;
    const controller = new RiderWalletController({
      async summary() {
        reads += 1;
        return {};
      },
      async transactions() {
        reads += 1;
        return {};
      },
    } as never);
    const guard = new RiderAccessGuard(ctx.service);

    await expect(guard.canActivate(http({ headers: { authorization: ctx.token(UserRole.CUSTOMER) } })))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(http({ headers: { authorization: ctx.token(UserRole.ADMIN) } })))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(() => controller.summary({})).toThrow(ForbiddenException);
    expect(() => controller.transactions({}, { riderProfileId: 'profile-2' })).toThrow(ForbiddenException);
    expect(reads).toBe(0);
  });

  it('reads the wallet for the authenticated rider profile', async () => {
    const ctx = access();
    const seen: string[] = [];
    const controller = new RiderWalletController({
      async summary(riderProfileId: string) {
        seen.push(riderProfileId);
        return { currency: 'USD', balance: '0.00' };
      },
      async transactions(riderProfileId: string) {
        seen.push(riderProfileId);
        return { transactions: [], nextCursor: null };
      },
    } as never);
    const request: RiderRequest = {
      headers: { authorization: ctx.token(UserRole.RIDER) },
    };
    await new RiderAccessGuard(ctx.service).canActivate(http(request));

    await controller.summary(request);
    await controller.transactions(request, { riderProfileId: 'profile-2', limit: '5' });
    expect(seen).toEqual(['profile-1', 'profile-1']);
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
    userId: 'user-1',
    revokedAt: null,
    replacedBySessionId: null,
    expiresAt: new Date(now.getTime() + 60_000),
  };
  const user = {
    id: 'user-1',
    role: UserRole.RIDER,
    accountStatus: AccountStatus.ACTIVE,
    phoneVerifiedAt: now,
    riderProfile: { id: 'profile-1', userId: 'user-1' },
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
  const tokens = new AccessTokenService();
  return {
    service: new RiderAccessService(db as unknown as PrismaService, tokens),
    token(role: UserRole) {
      return `Bearer ${tokens.sign({ sub: user.id, role, sid: session.id }, now).token}`;
    },
  };
}
