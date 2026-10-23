import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AuthSubjectRole, Prisma, UserRole } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { hashAdminPassword } from './admin-password.js';
import { hashSecret } from './token-hash.js';
import { PASSWORD_REGISTRATION_CLOSED, PasswordAuthService } from './password-auth.service.js';
import type { SessionService } from './session.service.js';
import { TooManyRequestsException } from './too-many-requests.exception.js';

const PHONE = '+263771234567';
const PASSWORD = 'correct horse battery';
const NEXT_PASSWORD = 'another correct horse';
const SESSION_EXPIRY = new Date('2027-01-01T00:00:00.000Z');
const REFRESH_TOKEN = 'current-refresh-token-value';

describe('PasswordAuthService', () => {
  it('does not create an account through direct password registration', async () => {
    const previous = process.env.WHATSAPP_VERIFICATION_ENABLED;
    try {
      for (const flag of [undefined, 'false', 'true']) {
        if (flag === undefined) {
          delete process.env.WHATSAPP_VERIFICATION_ENABLED;
        } else {
          process.env.WHATSAPP_VERIFICATION_ENABLED = flag;
        }
        const ctx = context();
        const riderFailure = await failure(ctx.service.registerRider({
          phone: PHONE,
          password: PASSWORD,
          fullName: 'Tatenda Moyo',
          address: '12 Samora Machel Avenue',
        }));
        expect(riderFailure).toBeInstanceOf(ForbiddenException);
        expect(riderFailure.message).toBe(PASSWORD_REGISTRATION_CLOSED);
        const customerFailure = await failure(ctx.service.registerCustomer({
          phone: PHONE,
          password: PASSWORD,
          accountKind: 'BUSINESS',
          businessName: 'Rudo Deliveries',
          contactName: 'Rudo Ncube',
          address: '4 Jason Moyo',
        }));
        expect(customerFailure).toBeInstanceOf(ForbiddenException);
        expect(customerFailure.message).toBe(PASSWORD_REGISTRATION_CLOSED);
        expect(ctx.users).toHaveLength(0);
        expect(ctx.profiles).toHaveLength(0);
        expect(ctx.accounts).toHaveLength(0);
        expect(ctx.wallets).toHaveLength(0);
        expect(ctx.issued).toEqual([]);
      }
    } finally {
      if (previous === undefined) {
        delete process.env.WHATSAPP_VERIFICATION_ENABLED;
      } else {
        process.env.WHATSAPP_VERIFICATION_ENABLED = previous;
      }
    }
  });

  it('lets an existing OTP account set a password without replacing its session', async () => {
    const ctx = context();
    const verifiedAt = new Date('2026-10-01T00:00:00.000Z');
    ctx.users.push(storedUser({ phoneVerifiedAt: verifiedAt, passwordHash: null }));
    ctx.sessions.push(openSession());
    const sessionsBefore = ctx.sessions.map((session) => ({ ...session }));

    await ctx.service.setPassword('user-1', 'session-1', UserRole.RIDER, { password: PASSWORD, refreshToken: REFRESH_TOKEN });

    expect(ctx.sessions).toEqual(sessionsBefore);
    expect(ctx.issued).toEqual([]);
    expect(ctx.revoked).toEqual([]);
    expect(ctx.users[0]?.phoneVerifiedAt).toBe(verifiedAt);
    expect(ctx.users[0]?.passwordHash).toMatch(/^\$argon2id\$/);
    await expect(ctx.service.login(AuthSubjectRole.RIDER, { phone: PHONE, password: PASSWORD }, '203.0.113.20'))
      .resolves.toEqual({ accessToken: 'access', refreshToken: 'refresh' });
    expect(ctx.attempts).toHaveLength(0);
    expect(ctx.sessions).toEqual(sessionsBefore);
  });

  it('lets an OTP business customer set a password and then sign in with it', async () => {
    const ctx = context();
    ctx.users.push(storedUser({
      role: 'CUSTOMER',
      phoneVerifiedAt: new Date('2026-10-01T00:00:00.000Z'),
      passwordHash: null,
      riderProfile: null,
      customerAccount: { id: 'account-1' },
    }));
    ctx.sessions.push(openSession());

    await ctx.service.setPassword('user-1', 'session-1', UserRole.CUSTOMER, { password: PASSWORD, refreshToken: REFRESH_TOKEN });

    await expect(ctx.service.login(AuthSubjectRole.CUSTOMER, { phone: PHONE, password: PASSWORD }, '203.0.113.21'))
      .resolves.toEqual({ accessToken: 'access', refreshToken: 'refresh' });
    expect(ctx.revoked).toEqual([]);
  });

  it('requires the current password before replacing one and keeps the session', async () => {
    const ctx = context();
    ctx.users.push(storedUser({ passwordHash: await hashAdminPassword(PASSWORD) }));
    ctx.sessions.push(openSession());

    await expect(ctx.service.setPassword('user-1', 'session-1', UserRole.RIDER, {
      password: NEXT_PASSWORD,
      refreshToken: REFRESH_TOKEN,
    })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(ctx.confirmed).toBe(0);
    expect(await hashMatches(ctx.users[0]?.passwordHash, PASSWORD)).toBe(true);

    await ctx.service.setPassword('user-1', 'session-1', UserRole.RIDER, {
      password: NEXT_PASSWORD,
      currentPassword: PASSWORD,
      refreshToken: 'wrong-refresh-token-value',
    });
    expect(ctx.confirmed).toBe(0);
    expect(ctx.sessions).toHaveLength(1);
    expect(ctx.sessions[0]?.revokedAt).toBeNull();
    await expect(ctx.service.login(AuthSubjectRole.RIDER, { phone: PHONE, password: NEXT_PASSWORD }, '203.0.113.22'))
      .resolves.toMatchObject({ accessToken: 'access' });
    await expect(ctx.service.login(AuthSubjectRole.RIDER, { phone: PHONE, password: PASSWORD }, '203.0.113.23'))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a revoked session and a short password without saving', async () => {
    const ctx = context();
    ctx.users.push(storedUser({ phoneVerifiedAt: new Date(), passwordHash: null }));
    ctx.sessions.push({ ...openSession(), revokedAt: new Date() });

    await expect(ctx.service.setPassword('user-1', 'session-1', UserRole.RIDER, { password: PASSWORD }))
      .rejects.toBeInstanceOf(UnauthorizedException);
    ctx.sessions[0]!.revokedAt = null;
    await expect(ctx.service.setPassword('user-1', 'session-1', UserRole.RIDER, {
      password: 'short',
      refreshToken: REFRESH_TOKEN,
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.users[0]?.passwordHash).toBeNull();
  });

  it('rejects a stolen access token, a wrong refresh token, and a token from another session', async () => {
    const ctx = context();
    ctx.users.push(storedUser({ phoneVerifiedAt: new Date(), passwordHash: null }));
    ctx.sessions.push(openSession());
    ctx.sessions.push({
      ...openSession(),
      id: 'session-2',
      tokenHash: hashSecret('other-session-refresh-token'),
    });
    const before = ctx.sessions.map((session) => ({ ...session }));

    const stolen = { password: PASSWORD };
    await expect(ctx.service.setPassword('user-1', 'session-1', UserRole.RIDER, stolen))
      .rejects.toBeInstanceOf(UnauthorizedException);

    const wrong = { password: PASSWORD, refreshToken: 'wrong-refresh-token-value' };
    const wrongFailure = await failure(ctx.service.setPassword('user-1', 'session-1', UserRole.RIDER, wrong));
    expect(wrongFailure.message).toBe('Authentication failed');
    expect(wrongFailure.message).not.toContain('wrong-refresh-token-value');
    expect(wrong.refreshToken).toBeUndefined();

    await expect(ctx.service.setPassword('user-1', 'session-1', UserRole.RIDER, {
      password: PASSWORD,
      refreshToken: 'other-session-refresh-token',
    })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(ctx.users[0]?.passwordHash).toBeNull();
    expect(ctx.sessions).toEqual(before);
    expect(ctx.revoked).toEqual([]);
  });

  it('rejects an expired refresh token without changing the session', async () => {
    const ctx = context();
    ctx.users.push(storedUser({ phoneVerifiedAt: new Date(), passwordHash: null }));
    ctx.sessions.push({ ...openSession(), expiresAt: new Date('2020-01-01T00:00:00.000Z') });

    await expect(ctx.service.setPassword('user-1', 'session-1', UserRole.RIDER, {
      password: PASSWORD,
      refreshToken: REFRESH_TOKEN,
    })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(ctx.users[0]?.passwordHash).toBeNull();
    expect(ctx.sessions[0]?.revokedAt).toBeNull();
    expect(ctx.confirmed).toBe(0);

    ctx.sessions[0]!.expiresAt = SESSION_EXPIRY;
    ctx.sessions[0]!.familyExpiresAt = new Date('2020-01-01T00:00:00.000Z');
    await expect(ctx.service.setPassword('user-1', 'session-1', UserRole.RIDER, {
      password: PASSWORD,
      refreshToken: REFRESH_TOKEN,
    })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(ctx.users[0]?.passwordHash).toBeNull();
    expect(ctx.sessions[0]?.revokedAt).toBeNull();
    expect(ctx.confirmed).toBe(1);
    expect(ctx.revoked).toEqual([]);
  });

  it('signs in a password account and rejects a wrong password without creating a delivery', async () => {
    const ctx = context();
    ctx.users.push(storedUser({ passwordHash: await hashAdminPassword(PASSWORD) }));

    await expect(ctx.service.login(AuthSubjectRole.RIDER, { phone: PHONE, password: PASSWORD }, '203.0.113.8'))
      .resolves.toEqual({ accessToken: 'access', refreshToken: 'refresh' });
    expect(ctx.issued).toEqual(['user-1']);
    expect(ctx.attempts).toHaveLength(0);
    expect(ctx.deliveries).toHaveLength(0);

    await expect(ctx.service.login(AuthSubjectRole.RIDER, { phone: PHONE, password: 'wrong password 1' }, '203.0.113.9'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(ctx.attempts).toHaveLength(1);
  });

  it('uses the same failure for a missing account and a wrong password', async () => {
    const ctx = context();
    ctx.users.push(storedUser({ passwordHash: await hashAdminPassword(PASSWORD) }));
    const missing = await failure(ctx.service.login(AuthSubjectRole.RIDER, { phone: '+263771111111', password: PASSWORD }, '198.51.100.2'));
    const wrong = await failure(ctx.service.login(AuthSubjectRole.RIDER, { phone: PHONE, password: 'wrong password 1' }, '198.51.100.3'));
    const otpOnly = context();
    otpOnly.users.push(storedUser({ phoneVerifiedAt: new Date(), passwordHash: null }));
    const otp = await failure(otpOnly.service.login(AuthSubjectRole.RIDER, { phone: PHONE, password: PASSWORD }, '198.51.100.4'));

    expect(missing).toBeInstanceOf(UnauthorizedException);
    expect(missing.message).toBe('Authentication failed');
    expect(wrong.message).toBe(missing.message);
    expect(otp.message).toBe(missing.message);
  });

  it('does not count a successful login and locks an address or phone after ten failures', async () => {
    const ctx = context();
    ctx.users.push(storedUser({ passwordHash: await hashAdminPassword(PASSWORD) }));
    await ctx.service.login(AuthSubjectRole.RIDER, { phone: PHONE, password: PASSWORD }, '203.0.113.10');
    expect(ctx.attempts).toHaveLength(0);

    for (let attempt = 0; attempt < 9; attempt += 1) {
      await expect(ctx.service.login(AuthSubjectRole.RIDER, { phone: PHONE, password: 'wrong password 1' }, '203.0.113.10'))
        .rejects.toBeInstanceOf(UnauthorizedException);
    }
    await expect(ctx.service.login(AuthSubjectRole.RIDER, { phone: PHONE, password: PASSWORD }, '203.0.113.10'))
      .resolves.toMatchObject({ accessToken: 'access' });
    expect(ctx.attempts).toHaveLength(9);

    await expect(ctx.service.login(AuthSubjectRole.RIDER, { phone: PHONE, password: 'wrong password 1' }, '203.0.113.10'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    await expect(ctx.service.login(AuthSubjectRole.RIDER, { phone: PHONE, password: 'wrong password 1' }, '203.0.113.10'))
      .rejects.toBeInstanceOf(TooManyRequestsException);
    expect(ctx.attempts).toHaveLength(10);

    const otherAddress = context();
    otherAddress.users.push(storedUser({ passwordHash: await hashAdminPassword(PASSWORD) }));
    for (let address = 0; address < 10; address += 1) {
      await expect(otherAddress.service.login(AuthSubjectRole.RIDER, { phone: PHONE, password: 'wrong password 1' }, `198.51.100.${address}`))
        .rejects.toBeInstanceOf(UnauthorizedException);
    }
    await expect(otherAddress.service.login(AuthSubjectRole.RIDER, { phone: PHONE, password: PASSWORD }, '198.51.100.40'))
      .rejects.toBeInstanceOf(TooManyRequestsException);
    await expect(otherAddress.service.login(AuthSubjectRole.RIDER, { phone: '+263772222222', password: 'wrong password 1' }, '198.51.100.40'))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });
});

async function failure(pending: Promise<unknown>): Promise<Error> {
  try {
    await pending;
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected a failure');
}

async function hashMatches(stored: string | null | undefined, password: string): Promise<boolean> {
  if (!stored) {
    return false;
  }
  const { verifyAdminPassword } = await import('./admin-password.js');
  return verifyAdminPassword(stored, password);
}

type StoredUser = {
  id: string;
  phone: string;
  role: string;
  accountStatus: string;
  phoneVerifiedAt: Date | null;
  passwordHash: string | null;
  riderProfile?: { id: string } | null;
  customerAccount?: { id: string } | null;
};

type SessionRow = {
  id: string;
  userId: string;
  tokenHash: string;
  revokedAt: Date | null;
  replacedBySessionId: string | null;
  expiresAt: Date;
  familyExpiresAt: Date;
};

type AttemptRow = { ipHash: string; phoneHash: string; createdAt: Date };

function storedUser(overrides: Partial<StoredUser> = {}): StoredUser {
  return {
    id: 'user-1',
    phone: PHONE,
    role: 'RIDER',
    accountStatus: 'ACTIVE',
    phoneVerifiedAt: null,
    passwordHash: null,
    riderProfile: { id: 'profile-1' },
    customerAccount: null,
    ...overrides,
  };
}

function openSession(): SessionRow {
  return {
    id: 'session-1',
    userId: 'user-1',
    tokenHash: hashSecret(REFRESH_TOKEN),
    revokedAt: null,
    replacedBySessionId: null,
    expiresAt: SESSION_EXPIRY,
    familyExpiresAt: SESSION_EXPIRY,
  };
}

function context() {
  const users: StoredUser[] = [];
  const profiles: unknown[] = [];
  const wallets: unknown[] = [];
  const accounts: unknown[] = [];
  const attempts: AttemptRow[] = [];
  const sessions: SessionRow[] = [];
  const deliveries: unknown[] = [];
  const issued: string[] = [];
  const revoked: string[] = [];
  let confirmed = 0;
  const state = { failUnique: false };
  const tx = {
    user: {
      async create({ data }: { data: StoredUser }) {
        if (state.failUnique || users.some((user) => user.phone === data.phone)) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '7.1.0' });
        }
        const row = { ...data, id: `user-${users.length + 1}` };
        users.push(row);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: { passwordHash: string } }) {
        const user = users.find((row) => row.id === where.id);
        if (!user) {
          throw new Error('missing user');
        }
        user.passwordHash = data.passwordHash;
        return user;
      },
    },
    riderProfile: {
      async create({ data }: { data: { userId: string } }) {
        const row = { id: `profile-${profiles.length + 1}`, ...data };
        profiles.push(row);
        return row;
      },
    },
    riderWallet: {
      async create({ data }: { data: unknown }) {
        wallets.push(data);
        return data;
      },
    },
    customerAccount: {
      async create({ data }: { data: unknown }) {
        accounts.push(data);
        return data;
      },
    },
    passwordLoginAttempt: {
      async count({ where }: { where: { ipHash?: string; phoneHash?: string; createdAt?: { gte: Date } } }) {
        return attempts.filter((attempt) => {
          if (where.ipHash && attempt.ipHash !== where.ipHash) {
            return false;
          }
          if (where.phoneHash && attempt.phoneHash !== where.phoneHash) {
            return false;
          }
          if (where.createdAt?.gte && attempt.createdAt < where.createdAt.gte) {
            return false;
          }
          return true;
        }).length;
      },
      async create({ data }: { data: AttemptRow }) {
        attempts.push(data);
        return data;
      },
    },
    refreshSession: {
      async findUnique({ where }: { where: { id: string } }) {
        return sessions.find((session) => session.id === where.id) ?? null;
      },
    },
    $queryRaw: async () => [],
  };
  const db = {
    ...tx,
    user: {
      ...tx.user,
      async findUnique({ where }: { where: { phone?: string; id?: string } }) {
        if (where.id) {
          return users.find((user) => user.id === where.id) ?? null;
        }
        return users.find((user) => user.phone === where.phone) ?? null;
      },
    },
    $transaction: async (callback: (writer: typeof tx) => Promise<unknown>) => callback(tx),
  };
  const sessionService = {
    async issue(_writer: unknown, userId: string) {
      issued.push(userId);
      return { accessToken: 'access', refreshToken: 'refresh' };
    },
    async revoke(sessionId: string) {
      revoked.push(sessionId);
      throw new Error('session revoked');
    },
    async revokeAll(userId: string) {
      revoked.push(userId);
      throw new Error('sessions revoked');
    },
    async refresh() {
      throw new Error('session refreshed');
    },
    async confirmCurrentRefreshToken(rawToken: string, sessionId: string, userId: string, now = new Date()) {
      confirmed += 1;
      if (rawToken.length < 20 || rawToken.length > 200) {
        throw new UnauthorizedException('Authentication failed');
      }
      const session = sessions.find((row) => row.id === sessionId);
      const expired = !session || session.expiresAt <= now || session.familyExpiresAt <= now;
      if (!session || session.userId !== userId || session.revokedAt || session.replacedBySessionId || expired) {
        throw new UnauthorizedException('Authentication failed');
      }
      if (hashSecret(rawToken) !== session.tokenHash) {
        throw new UnauthorizedException('Authentication failed');
      }
    },
  };
  return {
    users,
    profiles,
    wallets,
    accounts,
    deliveries,
    attempts,
    sessions,
    issued,
    revoked,
    get confirmed() {
      return confirmed;
    },
    get failUnique() {
      return state.failUnique;
    },
    set failUnique(value: boolean) {
      state.failUnique = value;
    },
    service: new PasswordAuthService(db as unknown as PrismaService, sessionService as unknown as SessionService),
  };
}
