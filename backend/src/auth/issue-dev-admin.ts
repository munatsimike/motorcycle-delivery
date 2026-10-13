// Local development only. From backend, after npm run build:
//   $env:NODE_ENV = 'development'
//   $env:ALLOW_DEV_ADMIN_BOOTSTRAP = 'true'
//   node dist/auth/issue-dev-admin.js --phone +263700000099 --name "Dev Admin"
// Then revoke every session for that admin with POST /auth/session/logout-all.
// The route accepts the printed access token even after it expires.
import path from 'node:path';
import { AccountStatus, UserRole } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessTokenService } from './access-token.service.js';
import { SessionService, type AuthTokens } from './session.service.js';

const LOCAL_DATABASE_NAME = 'delivery_db';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const E164_PHONE = /^\+[1-9][0-9]{7,14}$/;

export class DevAdminBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DevAdminBootstrapError';
  }
}

export function assertBootstrapEnvironment(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== 'development') {
    throw new DevAdminBootstrapError('Development admin bootstrap requires NODE_ENV=development');
  }
  if (env.ALLOW_DEV_ADMIN_BOOTSTRAP !== 'true') {
    throw new DevAdminBootstrapError('Development admin bootstrap requires ALLOW_DEV_ADMIN_BOOTSTRAP=true');
  }
}

export function assertLocalDevelopmentDatabase(databaseUrl: string): void {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new DevAdminBootstrapError('Development admin bootstrap requires the local delivery_db database');
  }
  const port = url.port === '' ? '5432' : url.port;
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (
    (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:')
    || !LOCAL_HOSTS.has(url.hostname)
    || port !== '5432'
    || databaseName !== LOCAL_DATABASE_NAME
  ) {
    throw new DevAdminBootstrapError('Development admin bootstrap requires the local delivery_db database');
  }
}

export function readDevAdminArguments(argv: string[]): { phone: string; fullName: string } {
  const phone = readOption(argv, '--phone');
  const fullName = readOption(argv, '--name')?.trim().replace(/\s+/g, ' ');
  if (!phone || !E164_PHONE.test(phone)) {
    throw new DevAdminBootstrapError('Pass --phone with an E.164 phone number');
  }
  if (!fullName || fullName.length > 200) {
    throw new DevAdminBootstrapError('Pass --name with the admin display name');
  }
  return { phone, fullName };
}

export async function issueDevAdminSession(
  prisma: PrismaService,
  sessions: SessionService,
  input: { phone: string; fullName: string },
): Promise<AuthTokens> {
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  if (rows[0]?.name !== LOCAL_DATABASE_NAME) {
    throw new DevAdminBootstrapError('Development admin bootstrap requires the local delivery_db database');
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { phone: input.phone } });
    if (existing && (existing.role === UserRole.RIDER || existing.role === UserRole.CUSTOMER)) {
      throw new DevAdminBootstrapError('That phone belongs to a rider or customer and was not changed');
    }
    if (existing && (existing.role !== UserRole.ADMIN || existing.accountStatus !== AccountStatus.ACTIVE)) {
      throw new DevAdminBootstrapError('That phone cannot be used for the development admin');
    }

    const user = existing ?? await tx.user.create({
      data: {
        fullName: input.fullName,
        phone: input.phone,
        role: UserRole.ADMIN,
        accountStatus: AccountStatus.ACTIVE,
        passwordHash: null,
        phoneVerifiedAt: null,
      },
    });
    return sessions.issue(tx, user.id, UserRole.ADMIN);
  });
}

export function formatDevAdminSession(tokens: AuthTokens): string {
  return [
    'Development admin session. Do not share these credentials.',
    `accessToken: ${tokens.accessToken}`,
    `refreshToken: ${tokens.refreshToken}`,
    'Revoke every session for this admin after testing with POST /auth/session/logout-all.',
    'That route accepts the access token above even after it expires.',
    'POST /auth/session/logout revokes only the session in that token.',
  ].join('\n');
}

async function main(): Promise<void> {
  assertBootstrapEnvironment(process.env);
  const input = readDevAdminArguments(process.argv.slice(2));
  const prisma = new PrismaService();
  try {
    assertLocalDevelopmentDatabase(process.env.DATABASE_URL ?? '');
    const sessions = new SessionService(prisma, new AccessTokenService());
    const tokens = await issueDevAdminSession(prisma, sessions, input);
    console.log(formatDevAdminSession(tokens));
  } finally {
    await prisma.$disconnect();
  }
}

function readOption(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    return undefined;
  }
  return value;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  const base = path.basename(entry);
  return base === 'issue-dev-admin.js' || base === 'issue-dev-admin.ts';
}

if (isDirectRun()) {
  main().catch((error: unknown) => {
    console.error(publicBootstrapError(error));
    process.exitCode = 1;
  });
}

export function publicBootstrapError(error: unknown): string {
  if (error instanceof DevAdminBootstrapError) {
    return error.message;
  }
  const message = error instanceof Error ? error.message : '';
  if (message.length > 0 && message.length <= 200 && !/postgres(ql)?:\/\//i.test(message) && !message.includes('@')) {
    return message;
  }
  return 'Development admin bootstrap failed';
}
