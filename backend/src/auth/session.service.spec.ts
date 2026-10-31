import { randomUUID } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountStatus, Prisma, UserRole } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AccessTokenService } from './access-token.service.js';
import { REFRESH_ABSOLUTE_MS, REFRESH_INACTIVITY_MS, REFRESH_REUSE_GRACE_MS } from './auth.constants.js';
import { SessionService } from './session.service.js';
import { RIDER_SIGNED_IN_ELSEWHERE } from './rider-session-policy.js';
import { hashSecret } from './token-hash.js';

const SECRET = '0123456789abcdef0123456789abcdef';
const DAY_MS = 24 * 60 * 60 * 1000;

type UserRow = {
  id: string;
  role: UserRole;
  accountStatus: AccountStatus;
  phoneVerifiedAt: Date | null;
  passwordHash?: string | null;
  riderProfile?: { id: string } | null;
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

describe('SessionService', () => {
  const tokens = new AccessTokenService();

  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.JWT_ACCESS_SECRET;
  });

  it('stores only the hash of a new refresh token', async () => {
    const store = memoryStore(rider());
    const service = new SessionService(store.db as unknown as PrismaService, tokens);
    const issued = await service.issue(store.db as unknown as Prisma.TransactionClient, store.users[0].id, UserRole.RIDER);
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0].tokenHash).toBe(hashSecret(issued.refreshToken));
    expect(JSON.stringify(store.sessions[0])).not.toContain(issued.refreshToken);
    expect(tokens.verify(issued.accessToken).sid).toBe(store.sessions[0].id);
  });

  it('rotates the session and rejects reuse of the previous token', async () => {
    const store = memoryStore(rider());
    const service = new SessionService(store.db as unknown as PrismaService, tokens);
    const issued = await service.issue(store.db as unknown as Prisma.TransactionClient, store.users[0].id, UserRole.RIDER);
    const rotated = await service.refresh(issued.refreshToken);

    expect(rotated.refreshToken).not.toBe(issued.refreshToken);
    expect(store.sessions).toHaveLength(2);
    expect(store.sessions[0].replacedBySessionId).toBe(store.sessions[1].id);
    expect(store.sessions[0].revokedAt).toBeInstanceOf(Date);
    expect(tokens.verify(rotated.accessToken).sid).toBe(store.sessions[1].id);

    await expect(service.refresh(issued.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(store.sessions[1].revokedAt).toBeNull();
    const continued = await service.refresh(rotated.refreshToken);
    expect(continued.refreshToken).not.toBe(rotated.refreshToken);
  });

  it('revokes an expired session without issuing a replacement', async () => {
    const store = memoryStore(rider());
    const service = new SessionService(store.db as unknown as PrismaService, tokens);
    const issued = await service.issue(store.db as unknown as Prisma.TransactionClient, store.users[0].id, UserRole.RIDER);
    store.sessions[0].expiresAt = new Date('2020-01-01T00:00:00.000Z');

    await expect(service.refresh(issued.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0].revokedAt).toBeInstanceOf(Date);
  });

  it('revokes sessions when the rider is no longer active', async () => {
    const user = rider();
    const store = memoryStore(user);
    const service = new SessionService(store.db as unknown as PrismaService, tokens);
    const issued = await service.issue(store.db as unknown as Prisma.TransactionClient, user.id, UserRole.RIDER);
    user.accountStatus = AccountStatus.SUSPENDED;

    await expect(service.refresh(issued.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(store.sessions[0].revokedAt).toBeInstanceOf(Date);
  });

  it('does not mint a second session when the token was already claimed', async () => {
    const store = memoryStore(rider());
    const service = new SessionService(store.db as unknown as PrismaService, tokens);
    const issued = await service.issue(store.db as unknown as Prisma.TransactionClient, store.users[0].id, UserRole.RIDER);
    store.db.refreshSession.updateMany = async () => ({ count: 0 });

    await expect(service.refresh(issued.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0].revokedAt).toBeNull();
  });

  it('rejects refresh when the phone is no longer verified', async () => {
    const user = rider();
    user.phoneVerifiedAt = new Date('2026-10-01T00:00:00.000Z');
    const store = memoryStore(user);
    const service = new SessionService(store.db as unknown as PrismaService, tokens);
    const issued = await service.issue(store.db as unknown as Prisma.TransactionClient, user.id, UserRole.RIDER);
    user.phoneVerifiedAt = null;

    await expect(service.refresh(issued.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('confirms the current refresh token without rotating or revoking the session', async () => {
    const user = rider();
    const store = memoryStore(user);
    const service = new SessionService(store.db as unknown as PrismaService, tokens);
    const issued = await service.issue(store.db as unknown as Prisma.TransactionClient, user.id, UserRole.RIDER);
    const before = JSON.stringify(store.sessions);

    await service.confirmCurrentRefreshToken(issued.refreshToken, store.sessions[0].id, user.id);

    expect(JSON.stringify(store.sessions)).toBe(before);
    expect(store.sessions[0].tokenHash).toBe(hashSecret(issued.refreshToken));
    expect(JSON.stringify(store.sessions)).not.toContain(issued.refreshToken);
  });

  it('rejects a wrong, foreign, revoked, replaced, or expired refresh token without changing other sessions', async () => {
    const user = account(UserRole.CUSTOMER);
    const store = memoryStore(user);
    const service = new SessionService(store.db as unknown as PrismaService, tokens);
    const first = await service.issue(store.db as unknown as Prisma.TransactionClient, user.id, UserRole.CUSTOMER);
    const second = await service.issue(store.db as unknown as Prisma.TransactionClient, user.id, UserRole.CUSTOMER);
    const firstSession = store.sessions[0];
    const secondSession = store.sessions[1];

    await expect(service.confirmCurrentRefreshToken('wrong-refresh-token-value', firstSession.id, user.id))
      .rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.confirmCurrentRefreshToken(second.refreshToken, firstSession.id, user.id))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(firstSession.revokedAt).toBeNull();
    expect(secondSession.revokedAt).toBeNull();

    firstSession.revokedAt = new Date('2026-10-23T00:00:00.000Z');
    await expect(service.confirmCurrentRefreshToken(first.refreshToken, firstSession.id, user.id))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(secondSession.revokedAt).toBeNull();

    firstSession.revokedAt = null;
    firstSession.replacedBySessionId = secondSession.id;
    await expect(service.confirmCurrentRefreshToken(first.refreshToken, firstSession.id, user.id))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(secondSession.revokedAt).toBeNull();

    firstSession.replacedBySessionId = null;
    firstSession.expiresAt = new Date('2020-01-01T00:00:00.000Z');
    await expect(service.confirmCurrentRefreshToken(first.refreshToken, firstSession.id, user.id))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(firstSession.revokedAt).toBeNull();
    expect(secondSession.revokedAt).toBeNull();

    firstSession.expiresAt = new Date('2099-01-01T00:00:00.000Z');
    firstSession.familyExpiresAt = new Date('2020-01-01T00:00:00.000Z');
    await expect(service.confirmCurrentRefreshToken(first.refreshToken, firstSession.id, user.id))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(firstSession.revokedAt).toBeNull();
    expect(secondSession.revokedAt).toBeNull();
  });

  it('rejects an expired or altered access token', () => {
    const user = rider();
    const signed = tokens.sign(
      { sub: user.id, role: UserRole.RIDER, sid: randomUUID() },
      new Date('2020-01-01T00:00:00.000Z'),
    );
    expect(() => tokens.verify(signed.token)).toThrow(UnauthorizedException);
    const parts = signed.token.split('.');
    parts[2] = `${parts[2]?.slice(0, -1)}${parts[2]?.endsWith('a') ? 'b' : 'a'}`;
    expect(() => tokens.verify(parts.join('.'))).toThrow(UnauthorizedException);
  });

  it('keeps a customer or rider signed in past 90 days while they keep refreshing', async () => {
    for (const role of [UserRole.RIDER, UserRole.CUSTOMER]) {
      const user = account(role);
      const store = memoryStore(user);
      const service = new SessionService(store.db as unknown as PrismaService, tokens);
      const start = new Date('2026-01-01T00:00:00.000Z');
      let current = await service.issue(store.db as unknown as Prisma.TransactionClient, user.id, role, start);
      expect(Date.parse(current.accessTokenExpiresAt) - start.getTime()).toBe(900_000);
      expect(Date.parse(current.refreshTokenExpiresAt) - start.getTime()).toBe(REFRESH_INACTIVITY_MS);

      let cursor = start;
      for (const day of [25, 50, 75, 100, 125]) {
        cursor = new Date(start.getTime() + day * DAY_MS);
        current = await service.refresh(current.refreshToken, cursor);
      }

      expect(cursor.getTime() - start.getTime()).toBeGreaterThan(90 * DAY_MS);
      const latest = store.sessions[store.sessions.length - 1];
      expect(latest.familyExpiresAt.getTime()).toBe(cursor.getTime() + REFRESH_INACTIVITY_MS);
      expect(latest.expiresAt.getTime()).toBe(cursor.getTime() + REFRESH_INACTIVITY_MS);
      expect(latest.revokedAt).toBeNull();
      expect(Date.parse(current.accessTokenExpiresAt) - cursor.getTime()).toBe(900_000);
    }
  });

  it('revokes a refresh token left unused for more than 30 days', async () => {
    const store = memoryStore(rider());
    const service = new SessionService(store.db as unknown as PrismaService, tokens);
    const start = new Date('2026-01-01T00:00:00.000Z');
    const issued = await service.issue(store.db as unknown as Prisma.TransactionClient, store.users[0].id, UserRole.RIDER, start);
    const idle = new Date(start.getTime() + REFRESH_INACTIVITY_MS + 1000);

    await expect(service.refresh(issued.refreshToken, idle)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0].revokedAt).toEqual(idle);
  });

  it('accepts one of two overlapping refreshes and leaves that session usable', async () => {
    const store = memoryStore(rider());
    const service = new SessionService(store.db as unknown as PrismaService, tokens);
    const issued = await service.issue(store.db as unknown as Prisma.TransactionClient, store.users[0].id, UserRole.RIDER);
    const presented = hashSecret(issued.refreshToken);
    let waiting = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = store.db.refreshSession.findUnique.bind(store.db.refreshSession);
    store.db.refreshSession.findUnique = async (args: { where: { tokenHash?: string; id?: string } }) => {
      const row = await original(args);
      if (args.where.tokenHash === presented) {
        waiting += 1;
        if (waiting === 2) {
          release();
        }
        await gate;
      }
      return row;
    };

    const results = await Promise.allSettled([
      service.refresh(issued.refreshToken),
      service.refresh(issued.refreshToken),
    ]);
    const succeeded = results.filter((result) => result.status === 'fulfilled');
    const failed = results.filter((result) => result.status === 'rejected');
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    const winner = succeeded[0]?.status === 'fulfilled' ? succeeded[0].value.refreshToken : '';
    const successor = store.sessions.find((session) => session.tokenHash === hashSecret(winner));
    expect(successor?.revokedAt).toBeNull();
    const continued = await service.refresh(winner);
    expect(continued.refreshToken).not.toBe(winner);
    expect(store.sessions.find((session) => session.tokenHash === hashSecret(continued.refreshToken))?.revokedAt).toBeNull();
  });

  it('revokes the family when a rotated token is replayed after the grace window', async () => {
    const store = memoryStore(rider());
    const service = new SessionService(store.db as unknown as PrismaService, tokens);
    const start = new Date('2026-03-01T00:00:00.000Z');
    const issued = await service.issue(store.db as unknown as Prisma.TransactionClient, store.users[0].id, UserRole.RIDER, start);
    const rotatedAt = new Date(start.getTime() + 1000);
    const rotated = await service.refresh(issued.refreshToken, rotatedAt);

    await expect(service.refresh(issued.refreshToken, new Date(rotatedAt.getTime() + 1000)))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(store.sessions[1].revokedAt).toBeNull();

    const replayAt = new Date(rotatedAt.getTime() + REFRESH_REUSE_GRACE_MS + 1000);
    await expect(service.refresh(issued.refreshToken, replayAt)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(store.sessions.every((session) => session.revokedAt instanceof Date)).toBe(true);
    await expect(service.refresh(rotated.refreshToken, replayAt)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('revokes the session when the account is deactivated', async () => {
    const user = rider();
    const store = memoryStore(user);
    const service = new SessionService(store.db as unknown as PrismaService, tokens);
    const issued = await service.issue(store.db as unknown as Prisma.TransactionClient, user.id, UserRole.RIDER);
    user.accountStatus = AccountStatus.DEACTIVATED;

    await expect(service.refresh(issued.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0].revokedAt).toBeInstanceOf(Date);
  });

  it('keeps an admin session on the fixed 90-day family', async () => {
    const user = account(UserRole.ADMIN);
    const store = memoryStore(user);
    const service = new SessionService(store.db as unknown as PrismaService, tokens);
    const start = new Date('2026-01-01T00:00:00.000Z');
    const issued = await service.issue(store.db as unknown as Prisma.TransactionClient, user.id, UserRole.ADMIN, start);
    const familyExpiresAt = store.sessions[0].familyExpiresAt.getTime();
    expect(familyExpiresAt).toBe(start.getTime() + REFRESH_ABSOLUTE_MS);

    const refreshed = await service.refresh(issued.refreshToken, new Date(start.getTime() + 40 * DAY_MS));
    expect(store.sessions[1].familyExpiresAt.getTime()).toBe(familyExpiresAt);
    expect(store.sessions[1].expiresAt.getTime()).toBe(familyExpiresAt);

    await expect(service.refresh(refreshed.refreshToken, new Date(start.getTime() + 91 * DAY_MS)))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(store.sessions[1].revokedAt).toBeInstanceOf(Date);
  });

  it('applies rider single-device rules to a customer role that has a rider profile', async () => {
    const user = account(UserRole.CUSTOMER);
    user.riderProfile = { id: randomUUID() };
    const store = memoryStore(user);
    const service = new SessionService(store.db as unknown as PrismaService, tokens);
    const first = await service.issue(store.db as unknown as Prisma.TransactionClient, user.id, UserRole.CUSTOMER, new Date(), { riderMembership: true });
    const second = await service.issue(store.db as unknown as Prisma.TransactionClient, user.id, UserRole.CUSTOMER, new Date(), { riderMembership: true });

    expect(tokens.verify(second.accessToken).role).toBe(UserRole.CUSTOMER);
    expect(store.sessions.filter((session) => session.revokedAt === null)).toHaveLength(1);
    expect(store.queries.some((query) => query.includes('FOR UPDATE'))).toBe(true);
    await expect(service.refresh(first.refreshToken)).rejects.toThrow(RIDER_SIGNED_IN_ELSEWHERE);

    const rotated = await service.refresh(second.refreshToken);
    expect(rotated.refreshToken).not.toBe(second.refreshToken);
    expect(tokens.verify(rotated.accessToken).role).toBe(UserRole.CUSTOMER);
    await expect(service.refresh(second.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(store.sessions.some((session) => session.revokedAt === null)).toBe(true);
  });

  it('replaces every active rider session and forgets the previous GPS point', async () => {
    const store = memoryStore(rider());
    const service = new SessionService(store.db as unknown as PrismaService, tokens);
    const first = await service.issue(store.db as unknown as Prisma.TransactionClient, store.users[0].id, UserRole.RIDER);
    const second = await service.issue(store.db as unknown as Prisma.TransactionClient, store.users[0].id, UserRole.RIDER);

    expect(store.sessions.filter((session) => session.revokedAt === null)).toHaveLength(1);
    expect(store.sessions[0].revokedAt).toBeInstanceOf(Date);
    expect(store.sessions[0].replacedBySessionId).toBeNull();
    expect(tokens.verify(second.accessToken).sid).toBe(store.sessions[1].id);
    expect(store.queries.some((query) => query.includes('FOR UPDATE'))).toBe(true);
    expect(store.statements.some((statement) => statement.includes('rider_locations'))).toBe(true);
    expect(store.statements.some((statement) => statement.includes('delivery_assignments'))).toBe(false);

    const continued = await service.refresh(second.refreshToken);
    expect(tokens.verify(continued.accessToken).sid).not.toBe(store.sessions[0].id);
    await expect(service.refresh(first.refreshToken)).rejects.toThrow(RIDER_SIGNED_IN_ELSEWHERE);
    await expect(service.revokeAllCurrent(store.sessions[0].id, store.users[0].id)).rejects.toThrow(RIDER_SIGNED_IN_ELSEWHERE);
    expect(store.sessions.some((session) => session.revokedAt === null)).toBe(true);
  });

  it('keeps a customer or admin signed in on more than one device', async () => {
    const customer = memoryStore(account(UserRole.CUSTOMER));
    const service = new SessionService(customer.db as unknown as PrismaService, tokens);
    await service.issue(customer.db as unknown as Prisma.TransactionClient, customer.users[0].id, UserRole.CUSTOMER);
    await service.issue(customer.db as unknown as Prisma.TransactionClient, customer.users[0].id, UserRole.CUSTOMER);
    expect(customer.sessions.filter((session) => session.revokedAt === null)).toHaveLength(2);
    expect(customer.queries).toEqual([]);

    const admin = memoryStore(account(UserRole.ADMIN));
    const adminSessions = new SessionService(admin.db as unknown as PrismaService, tokens);
    await adminSessions.issue(admin.db as unknown as Prisma.TransactionClient, admin.users[0].id, UserRole.ADMIN);
    await adminSessions.issue(admin.db as unknown as Prisma.TransactionClient, admin.users[0].id, UserRole.ADMIN);
    expect(admin.sessions.filter((session) => session.revokedAt === null)).toHaveLength(2);
    expect(admin.queries).toEqual([]);
  });

  it('serializes two rider sign-ins so only the last session stays active', async () => {
    const store = memoryStore(rider());
    const service = new SessionService(store.db as unknown as PrismaService, tokens);
    const userId = store.users[0].id;
    await Promise.all([
      service.issue(store.db as unknown as Prisma.TransactionClient, userId, UserRole.RIDER),
      service.issue(store.db as unknown as Prisma.TransactionClient, userId, UserRole.RIDER),
    ]);
    expect(store.sessions.filter((session) => session.revokedAt === null)).toHaveLength(1);
  });

  it('logout revokes one session and logout-all revokes every session for the user', async () => {
    const user = account(UserRole.CUSTOMER);
    const store = memoryStore(user);
    const service = new SessionService(store.db as unknown as PrismaService, tokens);
    const first = await service.issue(store.db as unknown as Prisma.TransactionClient, user.id, UserRole.CUSTOMER);
    const second = await service.issue(store.db as unknown as Prisma.TransactionClient, user.id, UserRole.CUSTOMER);
    await service.revokeCurrent(tokens.verify(first.accessToken).sid, user.id);
    expect(store.sessions[0].revokedAt).toBeInstanceOf(Date);
    expect(store.sessions[1].revokedAt).toBeNull();

    await service.revokeAllCurrent(tokens.verify(second.accessToken).sid, user.id);
    expect(store.sessions.every((session) => session.revokedAt instanceof Date)).toBe(true);
    await expect(service.refresh(second.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

function rider(): UserRow {
  return account(UserRole.RIDER);
}

function account(role: UserRole): UserRow {
  return {
    id: randomUUID(),
    role,
    accountStatus: AccountStatus.ACTIVE,
    phoneVerifiedAt: role === UserRole.ADMIN ? null : new Date('2026-10-13T12:00:00.000Z'),
  };
}

function memoryStore(user: UserRow) {
  const users = [user];
  const sessions: SessionRow[] = [];
  const queries: string[] = [];
  const statements: string[] = [];
  const db = {
    users,
    sessions,
    queries,
    statements,
    async $queryRaw(strings: TemplateStringsArray) {
      queries.push(strings.join(' '));
      return [];
    },
    async $executeRaw(strings: TemplateStringsArray) {
      statements.push(strings.join(' '));
      return 0;
    },
    refreshSession: {
      async findUnique({ where }: { where: { tokenHash?: string; id?: string } }) {
        return sessions.find((row) => where.tokenHash ? row.tokenHash === where.tokenHash : row.id === where.id) ?? null;
      },
      async findFirst({ where }: { where: { userId: string; revokedAt: null; id: { not: string } } }) {
        return sessions.find((row) => row.userId === where.userId && row.revokedAt === null && row.id !== where.id.not) ?? null;
      },
      async create({ data }: { data: Omit<SessionRow, 'id' | 'revokedAt' | 'replacedBySessionId'> }) {
        const row: SessionRow = { id: randomUUID(), revokedAt: null, replacedBySessionId: null, ...data };
        sessions.push(row);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: Partial<SessionRow> }) {
        const row = sessions.find((item) => item.id === where.id);
        if (!row) {
          throw new Error('session missing');
        }
        Object.assign(row, data);
        return row;
      },
      async updateMany({ where, data }: { where: Partial<SessionRow>; data: Partial<SessionRow> }) {
        const matched = sessions.filter((row) => Object.entries(where).every(([key, value]) => row[key as keyof SessionRow] === value));
        for (const row of matched) {
          Object.assign(row, data);
        }
        return { count: matched.length };
      },
    },
    user: {
      async findUnique({ where }: { where: { id: string } }) {
        return users.find((item) => item.id === where.id) ?? null;
      },
    },
    async $transaction<T>(callback: (tx: object) => Promise<T>) {
      return callback(db);
    },
  };
  return { db, sessions, users, queries, statements };
}
