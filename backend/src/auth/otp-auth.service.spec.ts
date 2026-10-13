import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AccountStatus,
  AuthPurpose,
  AuthSubjectRole,
  Prisma,
  UserRole,
} from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AccessTokenService } from './access-token.service.js';
import { Clock } from './clock.js';
import { OtpAuthService } from './otp-auth.service.js';
import { SessionService } from './session.service.js';
import { hashSecret } from './token-hash.js';
import { TooManyRequestsException } from './too-many-requests.exception.js';

const SECRET = '0123456789abcdef0123456789abcdef';
const PHONE = '0771234567';
const E164 = '+263771234567';

describe('OtpAuthService', () => {
  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.JWT_ACCESS_SECRET;
  });

  it('creates a passwordless rider and a hashed refresh session after the code is approved', async () => {
    const ctx = context();
    await ctx.otp.startRegistration(AuthSubjectRole.RIDER, registrationBody(), '203.0.113.10');
    const issued = await ctx.otp.verifyRegistration(AuthSubjectRole.RIDER, { phone: PHONE, code: '123456' });

    expect(ctx.twilio.startVerification).toHaveBeenCalledWith(E164);
    expect(ctx.users).toEqual([
      expect.objectContaining({
        phone: E164,
        role: UserRole.RIDER,
        accountStatus: AccountStatus.ACTIVE,
        passwordHash: null,
        fullName: 'Tendai Moyo',
      }),
    ]);
    expect(ctx.users[0].phoneVerifiedAt).toBeInstanceOf(Date);
    expect(ctx.profiles).toEqual([
      expect.objectContaining({
        userId: ctx.users[0].id,
        verificationStatus: 'PENDING',
        approvalStatus: 'PENDING',
        availability: 'OFFLINE',
        licenceNumber: null,
        licenceClass: null,
        verifiedAt: null,
        reviewerId: null,
      }),
    ]);
    expect(ctx.profiles[0]).not.toHaveProperty('licenceExpiresOn');
    expect(ctx.sessions[0].tokenHash).toBe(hashSecret(issued.refreshToken));
    expect(ctx.accessTokens.verify(issued.accessToken, ctx.clock.current).sub).toBe(ctx.users[0].id);
    expect(ctx.challenges[0].status).toBe('VERIFIED');
  });

  it('uses the same verification flow for a later customer registration', async () => {
    const ctx = context();
    await ctx.otp.startRegistration(AuthSubjectRole.CUSTOMER, registrationBody(), '203.0.113.11');
    await ctx.otp.verifyRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE, code: '123456' });
    expect(ctx.users[0].role).toBe(UserRole.CUSTOMER);
    expect(ctx.users[0].passwordHash).toBeNull();
    expect(ctx.profiles).toHaveLength(0);
  });

  it('does not send a code when the phone is already registered', async () => {
    const ctx = context();
    ctx.users.push(existingRider());
    await expect(ctx.otp.startRegistration(AuthSubjectRole.RIDER, registrationBody(), '203.0.113.12'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(ctx.twilio.startVerification).not.toHaveBeenCalled();
  });

  it('enforces the resend cooldown and the hourly send limit', async () => {
    const ctx = context();
    await ctx.otp.startRegistration(AuthSubjectRole.RIDER, registrationBody(), '203.0.113.13');
    await expect(ctx.otp.startRegistration(AuthSubjectRole.RIDER, registrationBody(), '203.0.113.13'))
      .rejects.toBeInstanceOf(TooManyRequestsException);
    expect(ctx.twilio.startVerification).toHaveBeenCalledTimes(1);

    for (let send = 1; send < 5; send += 1) {
      ctx.clock.current = new Date(ctx.clock.current.getTime() + 61_000);
      await ctx.otp.startRegistration(AuthSubjectRole.RIDER, registrationBody(), '203.0.113.13');
    }
    ctx.clock.current = new Date(ctx.clock.current.getTime() + 61_000);
    await expect(ctx.otp.startRegistration(AuthSubjectRole.RIDER, registrationBody(), '203.0.113.13'))
      .rejects.toBeInstanceOf(TooManyRequestsException);
    expect(ctx.twilio.startVerification).toHaveBeenCalledTimes(5);
    expect(ctx.challenges.filter((challenge) => challenge.status === 'PENDING')).toHaveLength(1);
  });

  it('stops calling Twilio when one address exceeds the hourly attempt limit', async () => {
    const ctx = context();
    const address = '203.0.113.14';
    for (let attempt = 0; attempt < 20; attempt += 1) {
      ctx.challenges.push(probe(hashSecret(address), ctx.clock.current, attempt));
    }
    await expect(ctx.otp.startRegistration(AuthSubjectRole.RIDER, registrationBody(), address))
      .rejects.toBeInstanceOf(TooManyRequestsException);
    expect(ctx.twilio.startVerification).not.toHaveBeenCalled();
  });

  it('returns the same pending response for an unknown or suspended login without sending SMS', async () => {
    const unknown = context();
    await expect(unknown.otp.startLogin(AuthSubjectRole.RIDER, { phone: PHONE }, '203.0.113.15'))
      .resolves.toEqual({ status: 'pending' });
    expect(unknown.twilio.startVerification).not.toHaveBeenCalled();

    const suspended = context();
    suspended.users.push({ ...existingRider(), accountStatus: AccountStatus.SUSPENDED });
    await expect(suspended.otp.startLogin(AuthSubjectRole.RIDER, { phone: PHONE }, '203.0.113.16'))
      .resolves.toEqual({ status: 'pending' });
    expect(suspended.twilio.startVerification).not.toHaveBeenCalled();
  });

  it('logs an active rider in without creating a second account', async () => {
    const ctx = context();
    ctx.users.push(existingRider());
    await ctx.otp.startLogin(AuthSubjectRole.RIDER, { phone: PHONE }, '203.0.113.17');
    const issued = await ctx.otp.verifyLogin(AuthSubjectRole.RIDER, { phone: PHONE, code: '123456' });
    expect(ctx.users).toHaveLength(1);
    expect(ctx.accessTokens.verify(issued.accessToken, ctx.clock.current).role).toBe(UserRole.RIDER);
  });

  it('locks the challenge after five wrong codes', async () => {
    const ctx = context();
    ctx.twilio.checkVerification.mockResolvedValue(false);
    await ctx.otp.startRegistration(AuthSubjectRole.RIDER, registrationBody(), '203.0.113.18');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(ctx.otp.verifyRegistration(AuthSubjectRole.RIDER, { phone: PHONE, code: '000000' }))
        .rejects.toBeInstanceOf(UnauthorizedException);
    }
    await expect(ctx.otp.verifyRegistration(AuthSubjectRole.RIDER, { phone: PHONE, code: '000000' }))
      .rejects.toBeInstanceOf(TooManyRequestsException);
    expect(ctx.twilio.checkVerification).toHaveBeenCalledTimes(5);
    expect(ctx.users).toHaveLength(0);
    expect(ctx.challenges.some((challenge) => challenge.status === 'LOCKED')).toBe(true);
  });

  it('does not check an expired code with Twilio', async () => {
    const ctx = context();
    await ctx.otp.startRegistration(AuthSubjectRole.RIDER, registrationBody(), '203.0.113.19');
    ctx.challenges[0].expiresAt = new Date('2020-01-01T00:00:00.000Z');
    await expect(ctx.otp.verifyRegistration(AuthSubjectRole.RIDER, { phone: PHONE, code: '123456' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(ctx.twilio.checkVerification).not.toHaveBeenCalled();
    expect(ctx.challenges[0].status).toBe('EXPIRED');
  });

  it('drops a challenge when the SMS provider fails and reports a registration race as a conflict', async () => {
    const failed = context();
    failed.twilio.startVerification.mockRejectedValue(new ServiceUnavailableException('SMS verification is unavailable'));
    await expect(failed.otp.startRegistration(AuthSubjectRole.RIDER, registrationBody(), '203.0.113.20'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(failed.challenges[0].status).toBe('SUPERSEDED');
    expect(failed.challenges[0].twilioSid).toBeNull();

    const raced = context();
    await raced.otp.startRegistration(AuthSubjectRole.RIDER, registrationBody(), '203.0.113.21');
    raced.rejectNextUser = true;
    await expect(raced.otp.verifyRegistration(AuthSubjectRole.RIDER, { phone: PHONE, code: '123456' }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(raced.users).toHaveLength(0);
  });

  describe('Dutch test numbers', () => {
    const dutch = '+31612345678';
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
      delete process.env.ALLOW_TEST_NL_PHONE_NUMBERS;
    });

    it('uses the same registration, verification, and login path for a Dutch mobile number', async () => {
      process.env.NODE_ENV = 'development';
      process.env.ALLOW_TEST_NL_PHONE_NUMBERS = 'true';
      const ctx = context();
      await ctx.otp.startRegistration(
        AuthSubjectRole.RIDER,
        { phone: '06 1234 5678', fullName: 'Test Rider' },
        '203.0.113.30',
      );
      expect(ctx.twilio.startVerification).toHaveBeenCalledWith(dutch);
      const issued = await ctx.otp.verifyRegistration(AuthSubjectRole.RIDER, { phone: dutch, code: '123456' });
      expect(ctx.users[0].phone).toBe(dutch);

      await ctx.otp.startLogin(AuthSubjectRole.RIDER, { phone: '31612345678' }, '203.0.113.31');
      await ctx.otp.verifyLogin(AuthSubjectRole.RIDER, { phone: '+31 6 12345678', code: '123456' });
      expect(ctx.twilio.checkVerification).toHaveBeenLastCalledWith(dutch, '123456');
      expect(ctx.users).toHaveLength(1);
      expect(ctx.accessTokens.verify(issued.accessToken, ctx.clock.current).sub).toBe(ctx.users[0].id);
    });

    it('keeps the resend cooldown for a Dutch test number', async () => {
      process.env.NODE_ENV = 'development';
      process.env.ALLOW_TEST_NL_PHONE_NUMBERS = 'true';
      const ctx = context();
      const body = { phone: dutch, fullName: 'Test Rider' };
      await ctx.otp.startRegistration(AuthSubjectRole.RIDER, body, '203.0.113.33');
      await expect(ctx.otp.startRegistration(AuthSubjectRole.RIDER, body, '203.0.113.33'))
        .rejects.toBeInstanceOf(TooManyRequestsException);
      expect(ctx.twilio.startVerification).toHaveBeenCalledTimes(1);
    });

    it('rejects Dutch numbers in production even when the flag is enabled', async () => {
      process.env.NODE_ENV = 'production';
      process.env.ALLOW_TEST_NL_PHONE_NUMBERS = 'true';
      const ctx = context();
      const body = { phone: dutch, fullName: 'Test Rider' };
      expect(() => ctx.otp.startRegistration(AuthSubjectRole.RIDER, body, '203.0.113.32'))
        .toThrow(BadRequestException);
      expect(() => ctx.otp.startLogin(AuthSubjectRole.RIDER, { phone: dutch }, '203.0.113.32'))
        .toThrow(BadRequestException);
      await expect(ctx.otp.verifyRegistration(AuthSubjectRole.RIDER, { phone: dutch, code: '123456' }))
        .rejects.toBeInstanceOf(BadRequestException);
      await expect(ctx.otp.verifyLogin(AuthSubjectRole.RIDER, { phone: dutch, code: '123456' }))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(ctx.twilio.startVerification).not.toHaveBeenCalled();
      expect(ctx.twilio.checkVerification).not.toHaveBeenCalled();
      await ctx.otp.startRegistration(AuthSubjectRole.RIDER, registrationBody(), '203.0.113.32');
      expect(ctx.twilio.startVerification).toHaveBeenCalledWith(E164);
    });
  });
});

function registrationBody() {
  return { phone: PHONE, fullName: 'Tendai Moyo' };
}

function existingRider(): UserRow {
  return {
    id: randomUUID(),
    fullName: 'Tendai Moyo',
    phone: E164,
    role: UserRole.RIDER,
    accountStatus: AccountStatus.ACTIVE,
    phoneVerifiedAt: new Date('2026-10-13T12:00:00.000Z'),
    passwordHash: null,
  };
}

function probe(ipHash: string, createdAt: Date, index: number): ChallengeRow {
  return {
    id: randomUUID(),
    phone: `+26377${String(index).padStart(7, '0')}`,
    subjectRole: AuthSubjectRole.RIDER,
    purpose: AuthPurpose.LOGIN,
    fullName: null,
    twilioSid: null,
    status: 'SUPERSEDED',
    sendCount: 0,
    checkAttempts: 0,
    lockedUntil: null,
    expiresAt: createdAt,
    ipHash,
    createdAt,
  };
}

type ProfileRow = {
  id: string;
  userId: string;
  verificationStatus: string;
  approvalStatus: string;
  availability: string;
  licenceNumber: string | null;
  licenceClass: string | null;
  verifiedAt: Date | null;
  reviewerId: string | null;
};

type UserRow = {
  id: string;
  fullName: string;
  phone: string;
  role: UserRole;
  accountStatus: AccountStatus;
  phoneVerifiedAt: Date | null;
  passwordHash: string | null;
};

type ChallengeRow = {
  id: string;
  phone: string;
  subjectRole: AuthSubjectRole;
  purpose: AuthPurpose;
  fullName: string | null;
  twilioSid: string | null;
  status: string;
  sendCount: number;
  checkAttempts: number;
  lockedUntil: Date | null;
  expiresAt: Date;
  ipHash: string | null;
  createdAt: Date;
};

type SessionRow = {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  familyExpiresAt: Date;
  revokedAt: Date | null;
  replacedBySessionId: string | null;
};

class TestClock extends Clock {
  current = new Date('2026-10-13T12:00:00.000Z');

  constructor() {
    super();
    this.concealmentMs = 0;
  }

  override now(): Date {
    return this.current;
  }
}

function context() {
  const clock = new TestClock();
  const users: UserRow[] = [];
  const profiles: ProfileRow[] = [];
  const challenges: ChallengeRow[] = [];
  const sessions: SessionRow[] = [];
  const state = { rejectNextUser: false };
  const db = {
    user: {
      async findUnique({ where }: { where: { id?: string; phone?: string } }) {
        return users.find((user) => where.id ? user.id === where.id : user.phone === where.phone) ?? null;
      },
      async create({ data }: { data: Omit<UserRow, 'id'> }) {
        if (state.rejectNextUser || users.some((user) => user.phone === data.phone)) {
          state.rejectNextUser = false;
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: '7.1.0',
          });
        }
        const user = { id: randomUUID(), ...data };
        users.push(user);
        return user;
      },
    },
    authChallenge: {
      async count({ where }: { where: Record<string, unknown> }) {
        return challenges.filter((row) => matches(row, where)).length;
      },
      async findFirst({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { createdAt: 'desc' } }) {
        const found = challenges.filter((row) => matches(row, where));
        if (orderBy?.createdAt === 'desc') {
          found.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
        }
        return found[0] ?? null;
      },
      async create({ data }: { data: Partial<ChallengeRow> & Pick<ChallengeRow, 'phone' | 'subjectRole' | 'purpose' | 'expiresAt'> }) {
        const row: ChallengeRow = {
          id: randomUUID(),
          fullName: null,
          twilioSid: null,
          status: 'PENDING',
          sendCount: 1,
          checkAttempts: 0,
          lockedUntil: null,
          ipHash: null,
          createdAt: new Date(),
          ...data,
        };
        challenges.push(row);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: Partial<ChallengeRow> }) {
        const row = challenges.find((item) => item.id === where.id);
        if (!row) {
          throw new Error('challenge missing');
        }
        Object.assign(row, data);
        return row;
      },
      async updateMany({ where, data }: { where: Record<string, unknown>; data: Partial<ChallengeRow> }) {
        const matched = challenges.filter((row) => matches(row, where));
        for (const row of matched) {
          Object.assign(row, data);
        }
        return { count: matched.length };
      },
    },
    riderProfile: {
      async create({ data }: { data: Partial<ProfileRow> & Pick<ProfileRow, 'userId'> }) {
        const row: ProfileRow = {
          id: randomUUID(),
          verificationStatus: 'PENDING',
          approvalStatus: 'PENDING',
          availability: 'OFFLINE',
          licenceNumber: null,
          licenceClass: null,
          verifiedAt: null,
          reviewerId: null,
          ...data,
        };
        profiles.push(row);
        return row;
      },
    },
    refreshSession: {
      async create({ data }: { data: Omit<SessionRow, 'id' | 'revokedAt' | 'replacedBySessionId'> }) {
        const row: SessionRow = { id: randomUUID(), revokedAt: null, replacedBySessionId: null, ...data };
        sessions.push(row);
        return row;
      },
    },
    async $transaction<T>(callback: (tx: typeof db) => Promise<T>) {
      return callback(db);
    },
  };
  const twilio = {
    startVerification: vi.fn(async () => ({ sid: 'VE123' })),
    checkVerification: vi.fn(async () => true),
  };
  const accessTokens = new AccessTokenService();
  const sessionsService = new SessionService(db as unknown as PrismaService, accessTokens);
  const otp = new OtpAuthService(db as unknown as PrismaService, twilio, sessionsService, clock);
  return {
    clock,
    otp,
    twilio,
    users,
    profiles,
    challenges,
    sessions,
    accessTokens,
    get rejectNextUser() {
      return state.rejectNextUser;
    },
    set rejectNextUser(value: boolean) {
      state.rejectNextUser = value;
    },
  };
}

function matches(row: object, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = (row as Record<string, unknown>)[key];
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      const filter = expected as { gte?: Date; gt?: Date | number; not?: unknown };
      if (filter.gte instanceof Date) {
        return actual instanceof Date && actual >= filter.gte;
      }
      if (filter.gt instanceof Date) {
        return actual instanceof Date && actual > filter.gt;
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
