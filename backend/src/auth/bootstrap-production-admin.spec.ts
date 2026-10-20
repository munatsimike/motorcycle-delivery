import { describe, expect, it } from 'vitest';
import { Prisma, AccountStatus, UserRole } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  assertCertificateVerifiedConnection,
  assertNoCredentialArguments,
  assertProductionBootstrapEnabled,
  classifyProductionAdminFailure,
  createProductionAdministrator,
  parseProductionAdminInput,
  PRODUCTION_ADMIN_CONFIRMATION,
  PRODUCTION_ADMIN_CREATED_MESSAGE,
  ProductionAdminBootstrapError,
  publicProductionAdminError,
  runProductionAdminBootstrap,
} from './bootstrap-production-admin.js';

const EMAIL = 'admin@example.com';
const PHONE = '0771234567';
const STORED_PHONE = '+263771234567';
const NAME = 'Tendai Moyo';
const PASSWORD = 'correct-horse-battery';
const ROOT_CA = `-----BEGIN CERTIFICATE-----
MIIDKjCCAhKgAwIBAgIQZAunKyc+w75OydeOxERpNzANBgkqhkiG9w0BAQsFADAa
MRgwFgYDVQQDDA9kYi5leGFtcGxlLnRlc3QwHhcNMjYxMDE4MjMxMTU5WhcNMjgx
MDE4MjMyMTU4WjAaMRgwFgYDVQQDDA9kYi5leGFtcGxlLnRlc3QwggEiMA0GCSqG
SIb3DQEBAQUAA4IBDwAwggEKAoIBAQDd17YB2lp+DOYFafoM8e5X2R3eqz6lpeTi
5i5FnpwxpNN6oA3XLAjaVgkxRwFFBjZYubXVs1SzN+eUfMSiZH1LkDWW5X2s+uiW
1h+idtvx5AE13/maOWcdRrwkFNZVoNEZY8ND1C3d9X0ooS4YtK5mcAsLhXvPi7kx
F9zTLHjCO+YxVpVYQfEqt0DKKzoRg5+t3hILhDEq4xtph3ppcED9VUd87A+b1eGu
qYS3C9lRjQuFZJwWPpiUdHQmJ3DdAvhDy5aPf9dMdAkh+GZhumWmmrUsc/NcDTwE
AIRy6nSy2z3C3BHhHYUQ51I1o71i/lRm7AX3zO9SbugHf+VQhWd1AgMBAAGjbDBq
MA4GA1UdDwEB/wQEAwIFoDAdBgNVHSUEFjAUBggrBgEFBQcDAgYIKwYBBQUHAwEw
GgYDVR0RBBMwEYIPZGIuZXhhbXBsZS50ZXN0MB0GA1UdDgQWBBQn4MMPPPDOvY5b
dgUdlukwvyp8XDANBgkqhkiG9w0BAQsFAAOCAQEAmcejcKsaYwL7/BPTqIMCtbqf
VLsJsr2RBtbfirlEelAsGYoLUtVXG4szeUMdtF4ElyV40JgdveG5bbzSyoPk0+oA
IHbbCkY2AD9ajka0OgoCtLvmOz2lR4tY/Q4NzJtC8mR5Gu8NcnvF89AQB/mgRuH8
z/Q7Vxq1r5Ev4a1DpJ+pW8dWUyCuKJT6IQ0cNtOENFoQm+cocLsKXh1+9RcaW8TG
fOxkjvihXOO9ZTk9DNlDQUVjzozDzbQiD/Nd8Vzf0UXl6kbKm4wTpV2BO4t8oJUT
sTh3lkMhVlqS2+45dmqhd3TvEnrKqjE0hmzkbuvJWregAwXChJtvMUep5XPEfQ==
-----END CERTIFICATE-----`;

describe('production administrator bootstrap guards', () => {
  it('requires the operator flag, refuses arguments, and confirms before writing', () => {
    expect(() => assertProductionBootstrapEnabled({})).toThrow(/RIDERS_PRODUCTION_ADMIN_BOOTSTRAP=true/);
    expect(() => assertProductionBootstrapEnabled({ RIDERS_PRODUCTION_ADMIN_BOOTSTRAP: 'TRUE' }))
      .toThrow(ProductionAdminBootstrapError);
    expect(() => assertProductionBootstrapEnabled({ RIDERS_PRODUCTION_ADMIN_BOOTSTRAP: 'true' })).not.toThrow();
    expect(() => assertNoCredentialArguments(['--password', PASSWORD])).toThrow(/arguments/);
    expect(() => assertNoCredentialArguments([])).not.toThrow();
  });

  it('requires a certificate-verified connection for a remote database and hides the URL', () => {
    const remote = 'postgresql://app:s3cret@db.example:5432/delivery?sslmode=require';
    expect(() => assertCertificateVerifiedConnection(undefined, undefined)).toThrow(/DATABASE_URL is not set/);
    expect(() => assertCertificateVerifiedConnection(remote, undefined)).toThrow(/DATABASE_SSL_CA/);
    try {
      assertCertificateVerifiedConnection(remote, 'not a certificate');
    } catch (error) {
      expect(error).toBeInstanceOf(ProductionAdminBootstrapError);
      expect((error as Error).message).not.toContain('s3cret');
      expect((error as Error).message).not.toContain('db.example');
    }
    expect(() => assertCertificateVerifiedConnection(remote, ROOT_CA)).not.toThrow();
    expect(() => assertCertificateVerifiedConnection('postgresql://app:s3cret@localhost:5432/delivery_db', undefined))
      .not.toThrow();
  });

  it('normalizes the operator input and rejects an invalid password before connecting', async () => {
    expect(parseProductionAdminInput({
      email: ' Admin@Example.com ',
      phone: PHONE,
      fullName: '  Tendai   Moyo ',
      password: PASSWORD,
    })).toMatchObject({
      email: EMAIL,
      phone: STORED_PHONE,
      fullName: NAME,
    });
    expect(() => parseProductionAdminInput({
      email: 'not-an-email',
      phone: PHONE,
      fullName: NAME,
      password: PASSWORD,
    })).toThrow(/email is invalid/);

    const database = memory();
    let connected = false;
    await expect(runProductionAdminBootstrap(
      database.prisma,
      { email: EMAIL, phone: PHONE, fullName: NAME, password: 'short' },
      PRODUCTION_ADMIN_CONFIRMATION,
      { connect: async () => { connected = true; } },
    )).rejects.toThrow(/12 to 128 characters/);
    expect(connected).toBe(false);
    expect(database.created).toHaveLength(0);

    await expect(runProductionAdminBootstrap(
      database.prisma,
      { email: EMAIL, phone: PHONE, fullName: NAME, password: PASSWORD },
      'yes',
    )).rejects.toThrow(/Confirmation is required/);
    expect(database.created).toHaveLength(0);
  });

  it('fails closed when the database connection or TLS check fails', async () => {
    const database = memory();
    await expect(runProductionAdminBootstrap(
      database.prisma,
      { email: EMAIL, phone: PHONE, fullName: NAME, password: PASSWORD },
      PRODUCTION_ADMIN_CONFIRMATION,
      {
        connect: async () => {
          throw new Error('connect postgresql://app:s3cret@db.example:5432/delivery');
        },
      },
    )).rejects.toThrow(ProductionAdminBootstrapError);
    expect(database.created).toHaveLength(0);
    expect(publicProductionAdminError(new Error('self signed certificate postgresql://app:s3cret@db.example/db')))
      .not.toContain('s3cret');
    expect(publicProductionAdminError(new Error('Database connectivity check failed')))
      .toBe('Database connectivity check failed');
    expect(PRODUCTION_ADMIN_CREATED_MESSAGE).toBe('Production administrator created.');
    expect(PRODUCTION_ADMIN_CREATED_MESSAGE).not.toContain('accessToken');
  });

  it('names the failure category without secrets', () => {
    const hash = '$argon2id$v=19$m=19456,t=2,p=1$salt$hash';
    const url = 'postgresql://app:s3cret@db.example:5432/delivery';
    const cases: Array<[unknown, string]> = [
      [wrapped(new ProductionAdminBootstrapError('An administrator account already exists')), 'An administrator account already exists'],
      [driverError('P2002', '23505', `duplicate ${url} ${hash}`), 'That email or phone already belongs to an account and was not changed'],
      [driverError('P2010', '42804', `Failed to deserialize column of type 'void'. ${url}`), 'The administrator lock query could not be read'],
      [driverError('P2028', '57014', `transaction timeout ${hash}`), 'The administrator bootstrap lock or transaction did not finish'],
      [driverError('P2000', '22001', `value too long ${hash}`), 'The administrator password hash does not fit the stored column'],
      [driverError('P2004', '23514', 'users_phone_e164_chk'), 'The administrator row did not satisfy a database check'],
      [driverError('P2011', '23502', 'null value'), 'A required administrator field was missing'],
      [driverError('P2007', '22P02', 'invalid enum'), 'The administrator role or account status was rejected by the database'],
      [driverError('P2022', '42703', 'column password_hash does not exist'), 'The database schema does not match this bootstrap'],
    ];
    for (const [error, message] of cases) {
      expect(classifyProductionAdminFailure(error)).toBe(message);
      expect(publicProductionAdminError(error)).toBe(message);
      expect(message).not.toContain('s3cret');
      expect(message).not.toContain('$argon2');
      expect(message).not.toContain('postgresql://');
    }
  });
});

describe('production administrator creation', () => {
  it('creates one active admin when none exists', async () => {
    const database = memory();
    await runProductionAdminBootstrap(
      database.prisma,
      { email: EMAIL, phone: PHONE, fullName: NAME, password: PASSWORD },
      `  ${PRODUCTION_ADMIN_CONFIRMATION}  `,
    );

    expect(database.created).toEqual([{
      fullName: NAME,
      phone: STORED_PHONE,
      email: EMAIL,
      role: UserRole.ADMIN,
      accountStatus: AccountStatus.ACTIVE,
      passwordHash: expect.stringMatching(/^\$argon2id\$/),
      phoneVerifiedAt: null,
    }]);
    expect(database.created[0]?.passwordHash).not.toBe(PASSWORD);
    expect(String(database.created[0]?.passwordHash).length).toBeLessThanOrEqual(255);
    expect(database.updates).toBe(0);
    expect(database.locked).toBe(true);
  });

  it('refuses when an active or inactive administrator already exists', async () => {
    for (const accountStatus of [AccountStatus.ACTIVE, AccountStatus.SUSPENDED, AccountStatus.DEACTIVATED, AccountStatus.PENDING]) {
      const database = memory([{
        id: 'admin-1',
        role: UserRole.ADMIN,
        accountStatus,
        email: 'existing@example.com',
        phone: '+263771111111',
      }]);
      await expect(createProductionAdministrator(database.prisma, storedAdmin())).rejects.toThrow(
        /already exists/,
      );
      expect(database.created).toHaveLength(0);
      expect(database.updates).toBe(0);
    }
  });

  it('lets only one concurrent bootstrap create the administrator', async () => {
    const database = memory();
    const results = await Promise.allSettled([
      createProductionAdministrator(database.prisma, storedAdmin('hash-one')),
      createProductionAdministrator(database.prisma, storedAdmin('hash-two')),
    ]);

    const created = results.filter((result) => result.status === 'fulfilled');
    const refused = results.filter((result) => result.status === 'rejected');
    expect(created).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason).toBeInstanceOf(ProductionAdminBootstrapError);
    expect(database.created).toHaveLength(1);
    expect(database.updates).toBe(0);
  });

  it('does not change an account that already uses the email or phone', async () => {
    const customer = memory([{
      id: 'customer-1',
      role: UserRole.CUSTOMER,
      accountStatus: AccountStatus.ACTIVE,
      email: EMAIL,
      phone: '+263770000000',
    }]);
    await expect(createProductionAdministrator(customer.prisma, storedAdmin())).rejects.toThrow(/was not changed/);
    expect(customer.created).toHaveLength(0);
    expect(customer.updates).toBe(0);

    const rider = memory([{
      id: 'rider-1',
      role: UserRole.RIDER,
      accountStatus: AccountStatus.ACTIVE,
      email: null,
      phone: STORED_PHONE,
    }]);
    await expect(createProductionAdministrator(rider.prisma, storedAdmin())).rejects.toThrow(/was not changed/);
    expect(rider.created).toHaveLength(0);
    expect(rider.updates).toBe(0);

    const raced = memory([], { conflictOnCreate: true });
    await expect(createProductionAdministrator(raced.prisma, storedAdmin())).rejects.toThrow(/was not changed/);
    expect(raced.created).toHaveLength(0);
    expect(raced.updates).toBe(0);
  });
});

type StoredUser = {
  id: string;
  role: UserRole;
  accountStatus: AccountStatus;
  email: string | null;
  phone: string;
};

function wrapped(error: ProductionAdminBootstrapError) {
  return Object.assign(new Error(`transaction failed ${error.message}`), {
    code: 'P2028',
    cause: error,
  });
}

function driverError(prismaCode: string, postgresCode: string, message: string) {
  return {
    code: prismaCode,
    message,
    meta: {
      driverAdapterError: {
        cause: {
          originalCode: postgresCode,
          originalMessage: message,
        },
      },
    },
  };
}

function storedAdmin(passwordHash = '$argon2id$stored') {
  return {
    email: EMAIL,
    phone: STORED_PHONE,
    fullName: NAME,
    passwordHash,
  };
}

function memory(initial: StoredUser[] = [], options?: { conflictOnCreate?: boolean }) {
  const users = initial.map((user) => ({ ...user }));
  const created: Array<Record<string, unknown>> = [];
  let updates = 0;
  let locked = false;
  const mutex = createMutex();

  const prisma = {
    async $transaction(fn: (tx: Transaction) => Promise<unknown>) {
      let release: (() => void) | undefined;
      const tx: Transaction = {
        async $queryRaw(strings: TemplateStringsArray) {
          const sql = strings.join(' ');
          if (!sql.includes('pg_advisory_xact_lock(724311, 1)::text AS lock_result')) {
            throw new Error('missing administrator bootstrap lock');
          }
          locked = true;
          release = await mutex.acquire();
        },
        user: {
          async findFirst(args: { where: { role?: UserRole; OR?: Array<{ phone?: string; email?: string }> } }) {
            if (args.where.role === UserRole.ADMIN) {
              return users.find((user) => user.role === UserRole.ADMIN) ?? null;
            }
            if (options?.conflictOnCreate) {
              return null;
            }
            const phone = args.where.OR?.find((item) => item.phone)?.phone;
            const email = args.where.OR?.find((item) => item.email)?.email;
            return users.find((user) => user.phone === phone || (email !== undefined && user.email === email)) ?? null;
          },
          async create({ data }: { data: Record<string, unknown> }) {
            if (options?.conflictOnCreate) {
              throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
                code: 'P2002',
                clientVersion: '7.1.0',
              });
            }
            users.push({
              id: 'admin-new',
              role: data.role as UserRole,
              accountStatus: data.accountStatus as AccountStatus,
              email: String(data.email),
              phone: String(data.phone),
            });
            created.push(data);
            return data;
          },
          async update() {
            updates += 1;
            throw new Error('existing account was modified');
          },
        },
      };
      try {
        return await fn(tx);
      } finally {
        release?.();
      }
    },
  };

  return {
    prisma: prisma as unknown as PrismaService,
    created,
    get updates() {
      return updates;
    },
    get locked() {
      return locked;
    },
  };
}

type Transaction = {
  $queryRaw: (strings: TemplateStringsArray) => Promise<void>;
  user: {
    findFirst: (args: { where: { role?: UserRole; OR?: Array<{ phone?: string; email?: string }> } }) => Promise<StoredUser | null>;
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
    update: () => Promise<never>;
  };
};

function createMutex() {
  let tail = Promise.resolve();
  return {
    acquire() {
      const previous = tail;
      let release: () => void = () => undefined;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      return previous.then(() => release);
    },
  };
}
