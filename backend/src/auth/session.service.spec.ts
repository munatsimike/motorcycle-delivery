import { randomUUID } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountStatus, Prisma, UserRole } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AccessTokenService } from './access-token.service.js';
import { SessionService } from './session.service.js';
import { hashSecret } from './token-hash.js';

const SECRET = '0123456789abcdef0123456789abcdef';

type UserRow = {
  id: string;
  role: UserRole;
  accountStatus: AccountStatus;
  phoneVerifiedAt: Date | null;
  passwordHash?: string | null;
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
    expect(store.sessions[1].revokedAt).toBeInstanceOf(Date);
    await expect(service.refresh(rotated.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
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

  it('refreshes a password account that has not verified the phone by SMS', async () => {
    const user = rider();
    user.phoneVerifiedAt = null;
    user.passwordHash = '$argon2id$stored';
    const store = memoryStore(user);
    const service = new SessionService(store.db as unknown as PrismaService, tokens);
    const issued = await service.issue(store.db as unknown as Prisma.TransactionClient, user.id, UserRole.RIDER);

    const refreshed = await service.refresh(issued.refreshToken);

    expect(refreshed.accessToken).not.toBe(issued.accessToken);
    expect(refreshed.refreshToken).not.toBe(issued.refreshToken);
    expect(store.sessions).toHaveLength(2);
    expect(store.sessions[1].revokedAt).toBeNull();
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
    const user = rider();
    const store = memoryStore(user);
    const service = new SessionService(store.db as unknown as PrismaService, tokens);
    const first = await service.issue(store.db as unknown as Prisma.TransactionClient, user.id, UserRole.RIDER);
    const second = await service.issue(store.db as unknown as Prisma.TransactionClient, user.id, UserRole.RIDER);
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

  it('logout revokes one session and logout-all revokes every session for the user', async () => {
    const user = rider();
    const store = memoryStore(user);
    const service = new SessionService(store.db as unknown as PrismaService, tokens);
    const first = await service.issue(store.db as unknown as Prisma.TransactionClient, user.id, UserRole.RIDER);
    const second = await service.issue(store.db as unknown as Prisma.TransactionClient, user.id, UserRole.RIDER);
    await service.revoke(tokens.verify(first.accessToken).sid, user.id);
    expect(store.sessions[0].revokedAt).toBeInstanceOf(Date);
    expect(store.sessions[1].revokedAt).toBeNull();

    await service.revokeAll(user.id);
    expect(store.sessions[1].revokedAt).toBeInstanceOf(Date);
    await expect(service.refresh(second.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

function rider(): UserRow {
  return {
    id: randomUUID(),
    role: UserRole.RIDER,
    accountStatus: AccountStatus.ACTIVE,
    phoneVerifiedAt: new Date('2026-10-13T12:00:00.000Z'),
  };
}

function memoryStore(user: UserRow) {
  const users = [user];
  const sessions: SessionRow[] = [];
  const db = {
    users,
    sessions,
    refreshSession: {
      async findUnique({ where }: { where: { tokenHash?: string; id?: string } }) {
        return sessions.find((row) => where.tokenHash ? row.tokenHash === where.tokenHash : row.id === where.id) ?? null;
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
    async $transaction<T>(callback: (tx: typeof db) => Promise<T>) {
      return callback(db);
    },
  };
  return { db, sessions, users };
}
