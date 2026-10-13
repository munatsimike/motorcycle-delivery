import { describe, expect, it } from 'vitest';
import { AccountStatus, UserRole } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  assertBootstrapEnvironment,
  assertLocalDevelopmentDatabase,
  DevAdminBootstrapError,
  formatDevAdminSession,
  issueDevAdminSession,
  publicBootstrapError,
  readDevAdminArguments,
} from './issue-dev-admin.js';
import type { SessionService } from './session.service.js';

const LOCAL_URL = 'postgresql://delivery_user:super-secret-password@localhost:5432/delivery_db';
const PHONE = '+263700000099';

describe('development admin bootstrap safety', () => {
  it('requires development and the explicit opt-in', () => {
    expect(() => assertBootstrapEnvironment({ NODE_ENV: 'production', ALLOW_DEV_ADMIN_BOOTSTRAP: 'true' }))
      .toThrow(DevAdminBootstrapError);
    expect(() => assertBootstrapEnvironment({ NODE_ENV: 'development', ALLOW_DEV_ADMIN_BOOTSTRAP: 'false' }))
      .toThrow(/ALLOW_DEV_ADMIN_BOOTSTRAP=true/);
    expect(() => assertBootstrapEnvironment({ NODE_ENV: 'development', ALLOW_DEV_ADMIN_BOOTSTRAP: 'TRUE' }))
      .toThrow(DevAdminBootstrapError);
    expect(() => assertBootstrapEnvironment({ NODE_ENV: 'development', ALLOW_DEV_ADMIN_BOOTSTRAP: 'true' }))
      .not.toThrow();
  });

  it('accepts only the local delivery_db database and does not echo the URL', () => {
    expect(() => assertLocalDevelopmentDatabase(LOCAL_URL)).not.toThrow();
    expect(() => assertLocalDevelopmentDatabase('postgresql://delivery_user:super-secret-password@127.0.0.1:5432/delivery_db'))
      .not.toThrow();

    expect(() => assertLocalDevelopmentDatabase('postgresql://delivery_user:super-secret-password@db.example.com:5432/delivery_db'))
      .toThrow(DevAdminBootstrapError);
    try {
      assertLocalDevelopmentDatabase('postgresql://delivery_user:super-secret-password@db.example.com:5432/other_db');
    } catch (error) {
      expect(error).toBeInstanceOf(DevAdminBootstrapError);
      expect((error as Error).message).not.toContain('super-secret-password');
      expect((error as Error).message).not.toContain('db.example.com');
    }
    expect(() => assertLocalDevelopmentDatabase('postgresql://delivery_user:super-secret-password@localhost:5433/delivery_db'))
      .toThrow(DevAdminBootstrapError);
    expect(publicBootstrapError(new Error(`connect ${LOCAL_URL}`))).toBe('Development admin bootstrap failed');
  });

  it('reads the phone and name from arguments', () => {
    expect(readDevAdminArguments(['--phone', PHONE, '--name', ' Dev   Admin '])).toEqual({
      phone: PHONE,
      fullName: 'Dev Admin',
    });
    expect(() => readDevAdminArguments(['--phone', '0771234567', '--name', 'Dev Admin'])).toThrow(DevAdminBootstrapError);
  });
});

describe('development admin account handling', () => {
  it('creates a separate active admin and issues a session for that user', async () => {
    const ctx = database(null);
    const tokens = await issueDevAdminSession(ctx.prisma, ctx.sessions, { phone: PHONE, fullName: 'Dev Admin' });

    expect(tokens.accessToken).toBe('access-token');
    expect(ctx.created).toEqual([{
      fullName: 'Dev Admin',
      phone: PHONE,
      role: UserRole.ADMIN,
      accountStatus: AccountStatus.ACTIVE,
      passwordHash: null,
      phoneVerifiedAt: null,
    }]);
    expect(ctx.issued).toEqual([{ userId: 'admin-1', role: UserRole.ADMIN }]);
    expect(ctx.updates).toBe(0);
    expect(formatDevAdminSession(tokens).match(/access-token/g)).toHaveLength(1);
    expect(formatDevAdminSession(tokens)).toContain('Do not share these credentials');
    expect(formatDevAdminSession(tokens)).toContain('POST /auth/session/logout-all');
  });

  it('reuses an active admin and does not change a rider or customer', async () => {
    const admin = database({ id: 'admin-9', role: UserRole.ADMIN, accountStatus: AccountStatus.ACTIVE });
    await issueDevAdminSession(admin.prisma, admin.sessions, { phone: PHONE, fullName: 'Someone Else' });
    expect(admin.created).toHaveLength(0);
    expect(admin.issued).toEqual([{ userId: 'admin-9', role: UserRole.ADMIN }]);
    expect(admin.updates).toBe(0);

    const rider = database({ id: 'rider-1', role: UserRole.RIDER, accountStatus: AccountStatus.ACTIVE });
    await expect(issueDevAdminSession(rider.prisma, rider.sessions, { phone: PHONE, fullName: 'Dev Admin' }))
      .rejects.toThrow(/was not changed/);
    expect(rider.created).toHaveLength(0);
    expect(rider.issued).toHaveLength(0);
    expect(rider.updates).toBe(0);

    const customer = database({ id: 'customer-1', role: UserRole.CUSTOMER, accountStatus: AccountStatus.ACTIVE });
    await expect(issueDevAdminSession(customer.prisma, customer.sessions, { phone: PHONE, fullName: 'Dev Admin' }))
      .rejects.toThrow(/was not changed/);
    expect(customer.updates).toBe(0);

    const suspended = database({ id: 'admin-2', role: UserRole.ADMIN, accountStatus: AccountStatus.SUSPENDED });
    await expect(issueDevAdminSession(suspended.prisma, suspended.sessions, { phone: PHONE, fullName: 'Dev Admin' }))
      .rejects.toBeInstanceOf(DevAdminBootstrapError);
    expect(suspended.created).toHaveLength(0);
    expect(suspended.updates).toBe(0);
  });

  it('does not create an admin when the connected database is not delivery_db', async () => {
    const ctx = database(null, 'postgres');
    await expect(issueDevAdminSession(ctx.prisma, ctx.sessions, { phone: PHONE, fullName: 'Dev Admin' }))
      .rejects.toThrow(/delivery_db/);
    expect(ctx.created).toHaveLength(0);
    expect(ctx.issued).toHaveLength(0);
  });
});

type StoredUser = {
  id: string;
  role: UserRole;
  accountStatus: AccountStatus;
};

function database(existing: StoredUser | null, databaseName = 'delivery_db') {
  const created: Array<Record<string, unknown>> = [];
  const issued: Array<{ userId: string; role: UserRole }> = [];
  let updates = 0;
  const tx = {
    user: {
      async findUnique() {
        return existing;
      },
      async create({ data }: { data: Record<string, unknown> & { id?: string } }) {
        created.push(data);
        return { id: 'admin-1', role: UserRole.ADMIN, accountStatus: AccountStatus.ACTIVE, ...data };
      },
      async update() {
        updates += 1;
        throw new Error('existing account was modified');
      },
    },
    riderProfile: {
      async create() {
        throw new Error('rider profile was created');
      },
    },
  };
  const prisma = {
    async $queryRaw(strings: TemplateStringsArray) {
      expect(strings.join(' ')).toContain('current_database()');
      return [{ name: databaseName }];
    },
    async $transaction<T>(fn: (transaction: typeof tx) => Promise<T>) {
      return fn(tx);
    },
  };
  const sessions = {
    async issue(_tx: typeof tx, userId: string, role: UserRole) {
      issued.push({ userId, role });
      return {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: '2026-10-13T12:15:00.000Z',
        refreshTokenExpiresAt: '2026-11-12T12:00:00.000Z',
      };
    },
  };
  return {
    prisma: prisma as unknown as PrismaService,
    sessions: sessions as unknown as SessionService,
    created,
    issued,
    get updates() {
      return updates;
    },
  };
}
