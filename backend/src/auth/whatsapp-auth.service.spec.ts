import { readFileSync } from 'node:fs';
import { ConflictException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountStatus, AuthChallengeStatus, AuthPurpose, AuthSubjectRole, RiderApprovalStatus, UserRole, VerificationChannel } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { Clock } from './clock.js';
import type { PhoneVerificationProvider } from './phone-verification.provider.js';
import type { SessionService } from './session.service.js';
import { DEV_OTP_TTL_MS } from './auth.constants.js';
import { TooManyRequestsException } from './too-many-requests.exception.js';
import { WhatsAppAuthService } from './whatsapp-auth.service.js';

const PHONE = '+263771234567';
const CODE = '123456';
const NOW = new Date('2026-10-23T12:00:00.000Z');

describe('WhatsApp verification', () => {
  afterEach(() => {
    delete process.env.WHATSAPP_VERIFICATION_ENABLED;
    delete process.env.WHATSAPP_VERIFICATION_PROVIDER;
    delete process.env.WHATSAPP_VERIFICATION_SERVICE_SID;
    delete process.env.WHATSAPP_VERIFICATION_SENDER;
  });

  it('does not create an account or call the provider when the rollout flag is off', async () => {
    const ctx = harness();
    delete process.env.WHATSAPP_VERIFICATION_ENABLED;
    await expect(ctx.service.startRegistration(AuthSubjectRole.RIDER, riderBody(), '203.0.113.8'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(ctx.users).toHaveLength(0);
    expect(ctx.sent).toEqual([]);
    expect(ctx.issued).toEqual([]);
  });

  it('requires WhatsApp consent before creating a pending registration', async () => {
    const ctx = harness();
    await expect(ctx.service.startRegistration(AuthSubjectRole.RIDER, { ...riderBody(), whatsappConsent: false }, '203.0.113.8'))
      .rejects.toThrow('Consent to WhatsApp authentication messages is required');
    expect(ctx.users).toHaveLength(0);
    expect(ctx.sent).toEqual([]);
  });

  it('keeps a new rider pending until the WhatsApp code is approved', async () => {
    const ctx = harness();
    await expect(ctx.service.startRegistration(AuthSubjectRole.RIDER, riderBody(), '203.0.113.8'))
      .resolves.toEqual({ status: 'pending' });

    expect(ctx.sent).toEqual([PHONE]);
    expect(ctx.issued).toEqual([]);
    expect(ctx.users[0]).toMatchObject({
      phone: PHONE,
      accountStatus: AccountStatus.PENDING,
      phoneVerifiedAt: null,
      role: UserRole.RIDER,
    });
    expect(ctx.users[0]?.whatsappConsentAt).toEqual(NOW);
    expect(ctx.users[0]?.passwordHash ?? null).toBeNull();
    expect(ctx.users[0]?.riderProfile).toMatchObject({
      approvalStatus: RiderApprovalStatus.PENDING,
      address: '12 Samora Machel Avenue',
    });
    expect(ctx.wallets).toHaveLength(1);
    expect(ctx.challenges[0]).not.toHaveProperty('code');
    expect(Object.values(ctx.challenges[0] ?? {})).not.toContain(CODE);
    expect(ctx.challenges[0]).toMatchObject({
      purpose: AuthPurpose.WHATSAPP_REGISTRATION,
      channel: VerificationChannel.WHATSAPP,
      status: AuthChallengeStatus.PENDING,
    });

    const body = { phone: PHONE, code: CODE };
    const tokens = await ctx.service.verifyRegistration(AuthSubjectRole.RIDER, body);
    expect(tokens).toMatchObject({ accessToken: 'access', refreshToken: 'refresh' });
    expect(body.code).toBeUndefined();
    expect(ctx.users[0]?.accountStatus).toBe(AccountStatus.ACTIVE);
    expect(ctx.users[0]?.phoneVerifiedAt).toEqual(NOW);
    expect(ctx.users[0]?.riderProfile?.approvalStatus).toBe(RiderApprovalStatus.PENDING);
    expect(ctx.issued).toEqual([ctx.users[0]?.id]);
  });

  it('signs in an existing account with a WhatsApp code and issues a session', async () => {
    const ctx = harness();
    ctx.users.push(user({ phoneVerifiedAt: NOW, accountStatus: AccountStatus.ACTIVE, whatsappConsentAt: NOW }));
    await expect(ctx.service.startLogin(AuthSubjectRole.RIDER, { phone: PHONE, whatsappConsent: true }, '203.0.113.20'))
      .resolves.toEqual({ status: 'pending' });
    expect(ctx.challenges[0]?.purpose).toBe(AuthPurpose.LOGIN);
    const tokens = await ctx.service.verifyLogin(AuthSubjectRole.RIDER, { phone: PHONE, code: CODE });
    expect(tokens).toMatchObject({ accessToken: 'access', refreshToken: 'refresh' });
    expect(ctx.issued).toEqual([ctx.users[0]?.id]);
  });

  it('does not send a sign-in code when the number has no account', async () => {
    const ctx = harness();
    await expect(ctx.service.startLogin(AuthSubjectRole.RIDER, { phone: PHONE, whatsappConsent: true }, '203.0.113.21'))
      .resolves.toEqual({ status: 'unavailable' });
    expect(ctx.sent).toEqual([]);
    expect(ctx.issued).toEqual([]);
  });

  it('rejects a wrong, expired, or repeated code without activating the account', async () => {
    const ctx = harness();
    await ctx.service.startRegistration(AuthSubjectRole.RIDER, riderBody(), '203.0.113.9');
    const wrong = { phone: PHONE, code: '000000' };
    const failure = await expectFailure(ctx.service.verifyRegistration(AuthSubjectRole.RIDER, wrong));
    expect(failure).toBeInstanceOf(UnauthorizedException);
    expect(failure.message).toBe('Verification code is invalid');
    expect(failure.message).not.toContain('000000');
    expect(wrong.code).toBeUndefined();
    expect(ctx.users[0]?.accountStatus).toBe(AccountStatus.PENDING);
    expect(ctx.checks).toEqual(['000000']);

    ctx.challenges[0]!.expiresAt = new Date('2020-01-01T00:00:00.000Z');
    ctx.checks.length = 0;
    await expect(ctx.service.verifyRegistration(AuthSubjectRole.RIDER, { phone: PHONE, code: CODE }))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(ctx.checks).toEqual([]);
    expect(ctx.users[0]?.phoneVerifiedAt).toBeNull();
  });

  it('does not replace an existing OTP account or send it a registration code', async () => {
    const ctx = harness();
    const verifiedAt = new Date('2026-10-01T00:00:00.000Z');
    ctx.users.push(user({
      phoneVerifiedAt: verifiedAt,
      passwordHash: null,
      accountStatus: AccountStatus.ACTIVE,
      whatsappConsentAt: null,
    }));

    await expect(ctx.service.startRegistration(AuthSubjectRole.RIDER, riderBody(), '203.0.113.10'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(ctx.sent).toEqual([]);
    expect(ctx.users[0]?.passwordHash).toBeNull();
    expect(ctx.users[0]?.phoneVerifiedAt).toEqual(verifiedAt);
    expect(ctx.users[0]?.accountStatus).toBe(AccountStatus.ACTIVE);
  });

  it('rate limits resend and still lets a later resend through', async () => {
    const ctx = harness();
    await ctx.service.startRegistration(AuthSubjectRole.CUSTOMER, customerBody(), '203.0.113.11');
    await expect(ctx.service.resendRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE }, '203.0.113.11'))
      .rejects.toBeInstanceOf(TooManyRequestsException);
    expect(ctx.sent).toHaveLength(1);

    ctx.now.setTime(NOW.getTime() + 61_000);
    await expect(ctx.service.resendRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE }, '203.0.113.11'))
      .resolves.toEqual({ status: 'pending' });
    expect(ctx.sent).toEqual([PHONE, PHONE]);
    expect(ctx.challenges.filter((challenge) => challenge.status === AuthChallengeStatus.PENDING)).toHaveLength(1);
  });

  it('uses a five-minute challenge for the local mock and keeps the code out of the response', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    process.env.DEV_OTP_ENABLED = 'true';
    try {
      const ctx = harness();
      delete process.env.WHATSAPP_VERIFICATION_ENABLED;
      delete process.env.WHATSAPP_VERIFICATION_PROVIDER;
      delete process.env.WHATSAPP_VERIFICATION_SERVICE_SID;
      delete process.env.WHATSAPP_VERIFICATION_SENDER;
      const started = await ctx.service.startRegistration(AuthSubjectRole.CUSTOMER, customerBody(), '203.0.113.41');
      expect(started).toEqual({ status: 'pending' });
      expect(JSON.stringify(started)).not.toContain(CODE);
      expect(ctx.challenges[0]?.expiresAt.getTime()).toBe(NOW.getTime() + DEV_OTP_TTL_MS);
      expect(ctx.challenges[0]).not.toHaveProperty('code');
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
      delete process.env.DEV_OTP_ENABLED;
    }
  });

  it('stops an address after the hourly verification limit', async () => {
    const ctx = harness();
    for (let index = 0; index < 20; index += 1) {
      const phone = `+26377${String(index).padStart(7, '0')}`;
      await ctx.service.startRegistration(AuthSubjectRole.RIDER, { ...riderBody(), phone }, '203.0.113.40');
    }
    await expect(ctx.service.startRegistration(
      AuthSubjectRole.RIDER,
      { ...riderBody(), phone: '+263770000020' },
      '203.0.113.40',
    )).rejects.toBeInstanceOf(TooManyRequestsException);
    expect(ctx.sent).toHaveLength(20);
  });

  it('leaves the one-accepted rider index and historical checksums untouched', () => {
    const sql = readFileSync('prisma/migrations/20261023200000_whatsapp_verification/migration.sql', 'utf8');
    expect(sql).toContain('WHATSAPP_REGISTRATION');
    expect(sql).toContain('PASSWORD_RECOVERY');
    expect(sql).toContain('whatsapp_consent_at');
    expect(sql).not.toMatch(/DROP\s+(INDEX|CONSTRAINT)/);
    expect(sql).not.toContain('delivery_assignments_one_accepted_per_rider_idx');
  });
});

function riderBody() {
  return {
    phone: '0771234567',
    fullName: 'Tatenda Moyo',
    address: '12 Samora Machel Avenue',
    whatsappConsent: true,
  };
}

function customerBody() {
  return {
    phone: PHONE,
    accountKind: 'INDIVIDUAL',
    fullName: 'Rudo Ncube',
    address: '4 Jason Moyo',
    whatsappConsent: true,
  };
}

function harness() {
  process.env.WHATSAPP_VERIFICATION_ENABLED = 'true';
  process.env.WHATSAPP_VERIFICATION_PROVIDER = 'twilio';
  process.env.WHATSAPP_VERIFICATION_SERVICE_SID = `VA${'c'.repeat(32)}`;
  process.env.WHATSAPP_VERIFICATION_SENDER = '+263771000000';
  const users: UserRow[] = [];
  const challenges: ChallengeRow[] = [];
  const sessions: SessionRow[] = [];
  const wallets: string[] = [];
  const sent: string[] = [];
  const checks: string[] = [];
  const issued: string[] = [];
  const now = new Date(NOW);
  const db = memory(users, challenges, sessions, wallets);
  const verification: PhoneVerificationProvider = {
    async send(phone: string) {
      sent.push(phone);
      return { sid: `VE${sent.length}` };
    },
    async check(_phone: string, code: string) {
      checks.push(code);
      return code === CODE;
    },
  };
  const sessionService = {
    async issue(_writer: unknown, userId: string) {
      issued.push(userId);
      sessions.push({ userId, revokedAt: null });
      return {
        accessToken: 'access',
        refreshToken: 'refresh',
        accessTokenExpiresAt: 'soon',
        refreshTokenExpiresAt: 'later',
      };
    },
    async revokeAll(userId: string, writer: typeof db) {
      await writer.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },
  };
  const clock: Clock = {
    concealmentMs: 0,
    now: () => new Date(now.getTime()),
    pause: () => Promise.resolve(),
  };
  return {
    users,
    challenges,
    sessions,
    wallets,
    sent,
    checks,
    issued,
    now,
    service: new WhatsAppAuthService(
      db as unknown as PrismaService,
      sessionService as unknown as SessionService,
      verification,
      clock,
    ),
  };
}

function user(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: randomUUID(),
    fullName: 'Tatenda Moyo',
    phone: PHONE,
    role: UserRole.RIDER,
    accountStatus: AccountStatus.PENDING,
    phoneVerifiedAt: null,
    passwordHash: 'stored-hash',
    whatsappConsentAt: NOW,
    riderProfile: { id: randomUUID(), approvalStatus: RiderApprovalStatus.PENDING, address: null },
    customerAccount: null,
    ...overrides,
  };
}

type UserRow = {
  id: string;
  fullName: string;
  phone: string;
  role: UserRole;
  accountStatus: AccountStatus;
  phoneVerifiedAt: Date | null;
  passwordHash: string | null;
  whatsappConsentAt: Date | null;
  riderProfile: { id: string; approvalStatus: RiderApprovalStatus; address: string | null } | null;
  customerAccount: { id: string } | null;
};

type ChallengeRow = {
  id: string;
  phone: string;
  subjectRole: AuthSubjectRole;
  purpose: AuthPurpose;
  channel: VerificationChannel;
  status: AuthChallengeStatus;
  sendCount: number;
  checkAttempts: number;
  lockedUntil: Date | null;
  expiresAt: Date;
  ipHash: string | null;
  twilioSid: string | null;
  createdAt: Date;
};

type SessionRow = { userId: string; revokedAt: Date | null };

function memory(users: UserRow[], challenges: ChallengeRow[], sessions: SessionRow[], wallets: string[]) {
  const db = {
    user: {
      async create({ data }: { data: Partial<UserRow> & { phone: string } }) {
        const created: UserRow = {
          id: randomUUID(),
          fullName: data.fullName ?? '',
          phone: data.phone,
          role: data.role ?? UserRole.RIDER,
          accountStatus: data.accountStatus ?? AccountStatus.PENDING,
          phoneVerifiedAt: data.phoneVerifiedAt ?? null,
          passwordHash: data.passwordHash ?? null,
          whatsappConsentAt: data.whatsappConsentAt ?? null,
          riderProfile: null,
          customerAccount: null,
        };
        users.push(created);
        return created;
      },
      async findUnique({ where }: { where: { phone?: string; id?: string } }) {
        const found = users.find((row) => (where.id ? row.id === where.id : row.phone === where.phone));
        return found ? { ...found, riderProfile: found.riderProfile, customerAccount: found.customerAccount } : null;
      },
      async findUniqueOrThrow(input: { where: { id?: string; phone?: string } }) {
        const found = await db.user.findUnique(input);
        if (!found) {
          throw new Error('missing user');
        }
        return found;
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const found = users.find((row) => row.id === where.id);
        if (!found) {
          throw new Error('missing user');
        }
        const { customerAccount, riderProfile, ...rest } = data;
        Object.assign(found, rest);
        if (customerAccount && typeof customerAccount === 'object' && 'update' in customerAccount && found.customerAccount) {
          Object.assign(found.customerAccount, (customerAccount as { update: object }).update);
        }
        if (riderProfile && typeof riderProfile === 'object' && 'update' in riderProfile && found.riderProfile) {
          Object.assign(found.riderProfile, (riderProfile as { update: object }).update);
        }
        return found;
      },
    },
    riderProfile: {
      async create({ data }: { data: { userId: string; approvalStatus: RiderApprovalStatus; address?: string | null } }) {
        const profile = { id: randomUUID(), approvalStatus: data.approvalStatus, address: data.address ?? null };
        const owner = users.find((row) => row.id === data.userId);
        if (owner) {
          owner.riderProfile = profile;
        }
        return profile;
      },
    },
    customerAccount: {
      async create({ data }: { data: { userId: string } }) {
        const account = { id: randomUUID() };
        const owner = users.find((row) => row.id === data.userId);
        if (owner) {
          owner.customerAccount = account;
        }
        return account;
      },
    },
    riderWallet: {
      async create({ data }: { data: { riderProfileId: string } }) {
        wallets.push(data.riderProfileId);
        return data;
      },
    },
    authChallenge: {
      async create({ data }: { data: Partial<ChallengeRow> & { phone: string } }) {
        const created: ChallengeRow = {
          id: randomUUID(),
          phone: data.phone,
          subjectRole: data.subjectRole ?? AuthSubjectRole.RIDER,
          purpose: data.purpose ?? AuthPurpose.WHATSAPP_REGISTRATION,
          channel: data.channel ?? VerificationChannel.WHATSAPP,
          status: data.status ?? AuthChallengeStatus.PENDING,
          sendCount: data.sendCount ?? 1,
          checkAttempts: data.checkAttempts ?? 0,
          lockedUntil: data.lockedUntil ?? null,
          expiresAt: data.expiresAt ?? NOW,
          ipHash: data.ipHash ?? null,
          twilioSid: data.twilioSid ?? null,
          createdAt: data.createdAt ?? NOW,
        };
        challenges.push(created);
        return created;
      },
      async update({ where, data }: { where: { id: string }; data: Partial<ChallengeRow> }) {
        const found = challenges.find((row) => row.id === where.id);
        if (!found) {
          throw new Error('missing challenge');
        }
        Object.assign(found, data);
        return found;
      },
      async updateMany({ where, data }: { where: Record<string, unknown>; data: Partial<ChallengeRow> }) {
        const matches = challenges.filter((row) => matchesWhere(row, where));
        matches.forEach((row) => Object.assign(row, data));
        return { count: matches.length };
      },
      async findFirst({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { createdAt: 'desc' } }) {
        const matches = challenges.filter((row) => matchesWhere(row, where));
        if (orderBy?.createdAt === 'desc') {
          matches.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
        }
        return matches[0] ?? null;
      },
      async count({ where }: { where: Record<string, unknown> }) {
        return challenges.filter((row) => matchesWhere(row, where)).length;
      },
    },
    refreshSession: {
      async updateMany({ where, data }: { where: Record<string, unknown>; data: Partial<SessionRow> }) {
        const matches = sessions.filter((row) => matchesWhere(row, where));
        matches.forEach((row) => Object.assign(row, data));
        return { count: matches.length };
      },
    },
    async $transaction<T>(callback: (writer: typeof db) => Promise<T>) {
      return callback(db);
    },
  };
  return db;
}

function matchesWhere(row: object, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = (row as Record<string, unknown>)[key];
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      const filter = expected as { gte?: Date; gt?: Date | number; not?: unknown };
      if (filter.gte instanceof Date) {
        return actual instanceof Date && actual.getTime() >= filter.gte.getTime();
      }
      if (filter.gt instanceof Date) {
        return actual instanceof Date && actual.getTime() > filter.gt.getTime();
      }
      if (typeof filter.gt === 'number') {
        return typeof actual === 'number' && actual > filter.gt;
      }
      if ('not' in filter) {
        return actual !== filter.not;
      }
    }
    return actual === expected;
  });
}

async function expectFailure(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
  }
  throw new Error('expected a failure');
}
