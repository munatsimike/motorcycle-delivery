// One-time production administrator bootstrap. This is not an HTTP route.
// From backend, after npm run build, set the production database environment
// in the shell (not as arguments):
//   $env:RIDERS_PRODUCTION_ADMIN_BOOTSTRAP = 'true'
//   $env:DATABASE_URL = '<production connection string>'
//   $env:DATABASE_SSL_CA = '<database CA PEM>'
//   node dist/auth/bootstrap-production-admin.js
// The terminal then asks for the email, Zimbabwe mobile, full name, and password.
// Type CREATE PRODUCTION ADMIN when asked, before any account is written.
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { stdin, stdout } from 'node:process';
import type { PoolConfig } from 'pg';
import { AccountStatus, UserRole } from '../generated/prisma/client.js';
import { databasePoolConfig, describeDatabaseError, redactSecrets } from '../prisma/database-connection.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashAdminPassword } from './admin-password.js';
import { InvalidPersonNameError, normalizePersonName } from './person-name.js';
import { InvalidPhoneNumberError, normalizeZimbabweMobile } from './phone-number.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const SAFE_CONNECTION_MESSAGES = new Set([
  'DATABASE_URL is not set',
  'Database connectivity check failed',
  'DATABASE_SSL_CA is not a PEM certificate',
  'DATABASE_URL could not be parsed',
  'DATABASE_URL is missing a host or database',
  'DATABASE_URL has an invalid port',
]);

export const PRODUCTION_ADMIN_CONFIRMATION = 'CREATE PRODUCTION ADMIN';
export const PRODUCTION_ADMIN_CREATED_MESSAGE = 'Production administrator created.';

export class ProductionAdminBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductionAdminBootstrapError';
  }
}

export type ProductionAdminInput = {
  email: string;
  phone: string;
  fullName: string;
  password: string;
};

type PasswordHasher = (password: string) => Promise<string>;

export function assertProductionBootstrapEnabled(env: NodeJS.ProcessEnv): void {
  if (env.RIDERS_PRODUCTION_ADMIN_BOOTSTRAP !== 'true') {
    throw new ProductionAdminBootstrapError(
      'Production administrator bootstrap requires RIDERS_PRODUCTION_ADMIN_BOOTSTRAP=true',
    );
  }
}

export function assertNoCredentialArguments(argv: string[]): void {
  if (argv.some((argument) => argument.startsWith('--'))) {
    throw new ProductionAdminBootstrapError('Do not pass administrator credentials as arguments');
  }
}

export function assertProductionAdminConfirmation(confirmation: string): void {
  if (confirmation.trim() !== PRODUCTION_ADMIN_CONFIRMATION) {
    throw new ProductionAdminBootstrapError(
      'Confirmation is required before creating the production administrator',
    );
  }
}

export function assertCertificateVerifiedConnection(
  databaseUrl: string | undefined,
  sslCa: string | undefined,
): void {
  if (!databaseUrl) {
    throw new ProductionAdminBootstrapError('DATABASE_URL is not set');
  }

  let config: PoolConfig;
  try {
    config = databasePoolConfig(databaseUrl, sslCa);
  } catch (error) {
    throw new ProductionAdminBootstrapError(publicProductionAdminError(error));
  }

  if (LOCAL_HOSTS.has(connectionHost(databaseUrl, config))) {
    return;
  }
  const ssl = config.ssl;
  if (
    typeof ssl !== 'object'
    || ssl === null
    || ssl.rejectUnauthorized !== true
    || !ssl.ca
  ) {
    throw new ProductionAdminBootstrapError('Production administrator bootstrap requires DATABASE_SSL_CA');
  }
}

export function parseProductionAdminInput(input: ProductionAdminInput): ProductionAdminInput {
  const email = input.email.trim().toLowerCase();
  if (email.length === 0 || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new ProductionAdminBootstrapError('Administrator email is invalid');
  }

  let phone: string;
  try {
    phone = normalizeZimbabweMobile(input.phone);
  } catch (error) {
    if (error instanceof InvalidPhoneNumberError) {
      throw new ProductionAdminBootstrapError('Enter a valid Zimbabwe mobile number');
    }
    throw new ProductionAdminBootstrapError('Enter a valid Zimbabwe mobile number');
  }

  let fullName: string;
  try {
    fullName = normalizePersonName(input.fullName);
  } catch (error) {
    if (error instanceof InvalidPersonNameError) {
      throw new ProductionAdminBootstrapError('Full name is required');
    }
    throw new ProductionAdminBootstrapError('Full name is required');
  }

  return {
    email,
    phone,
    fullName,
    password: input.password,
  };
}

export function publicProductionAdminError(error: unknown): string {
  const failure = classifyProductionAdminFailure(error);
  if (failure !== 'Production administrator bootstrap failed') {
    return failure;
  }
  if (error instanceof Error && SAFE_CONNECTION_MESSAGES.has(error.message)) {
    return error.message;
  }
  const described = describeDatabaseError(error, 'Production administrator bootstrap failed');
  if (containsSecret(described)) {
    return 'Production administrator bootstrap failed';
  }
  return described;
}

export function classifyProductionAdminFailure(error: unknown): string {
  const explicit = findBootstrapError(error);
  if (explicit) {
    return explicit.message;
  }

  const codes = databaseCodes(error);
  const diagnostic = redactedDiagnostic(error);
  if (codes.has('23505') || codes.has('P2002')) {
    return 'That email or phone already belongs to an account and was not changed';
  }
  if (/deserialize column of type ['"]?void['"]?/i.test(diagnostic) || /column of type void/i.test(diagnostic)) {
    return 'The administrator lock query could not be read';
  }
  if (codes.has('P2028') || codes.has('57014') || codes.has('55P03')) {
    return 'The administrator bootstrap lock or transaction did not finish';
  }
  if (codes.has('22001')) {
    return 'The administrator password hash does not fit the stored column';
  }
  if (codes.has('23514')) {
    return 'The administrator row did not satisfy a database check';
  }
  if (codes.has('23502')) {
    return 'A required administrator field was missing';
  }
  if (codes.has('22P02')) {
    return 'The administrator role or account status was rejected by the database';
  }
  if (codes.has('42703') || codes.has('42P01') || codes.has('42883')) {
    return 'The database schema does not match this bootstrap';
  }

  const prismaCode = [...codes].find((code) => /^P[0-9]{4}$/.test(code));
  if (prismaCode) {
    return `Production administrator bootstrap failed (${prismaCode})`;
  }
  const postgresCode = [...codes].find((code) => /^[0-9A-Z]{5}$/.test(code));
  if (postgresCode) {
    return `Production administrator bootstrap failed (${postgresCode})`;
  }
  return 'Production administrator bootstrap failed';
}

export async function runProductionAdminBootstrap(
  prisma: PrismaService,
  input: ProductionAdminInput,
  confirmation: string,
  options?: {
    connect?: () => Promise<void>;
    hashPassword?: PasswordHasher;
  },
): Promise<void> {
  assertProductionAdminConfirmation(confirmation);
  const administrator = parseProductionAdminInput(input);
  const passwordHash = await hashProductionPassword(
    administrator.password,
    options?.hashPassword ?? hashAdminPassword,
  );
  if (options?.connect) {
    try {
      await options.connect();
    } catch (error) {
      throw new ProductionAdminBootstrapError(publicProductionAdminError(error));
    }
  }
  await createProductionAdministrator(prisma, {
    email: administrator.email,
    phone: administrator.phone,
    fullName: administrator.fullName,
    passwordHash,
  });
}

export async function createProductionAdministrator(
  prisma: PrismaService,
  administrator: {
    email: string;
    phone: string;
    fullName: string;
    passwordHash: string;
  },
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(724311, 1)::text AS lock_result
      `;

      const existingAdmin = await tx.user.findFirst({
        where: { role: UserRole.ADMIN },
        select: { id: true },
      });
      if (existingAdmin) {
        throw new ProductionAdminBootstrapError('An administrator account already exists');
      }

      const existingAccount = await tx.user.findFirst({
        where: {
          OR: [
            { phone: administrator.phone },
            { email: administrator.email },
          ],
        },
        select: { id: true },
      });
      if (existingAccount) {
        throw new ProductionAdminBootstrapError(
          'That email or phone already belongs to an account and was not changed',
        );
      }

      await tx.user.create({
        data: {
          fullName: administrator.fullName,
          phone: administrator.phone,
          email: administrator.email,
          role: UserRole.ADMIN,
          accountStatus: AccountStatus.ACTIVE,
          passwordHash: administrator.passwordHash,
          phoneVerifiedAt: null,
        },
      });
    }, { maxWait: 10_000, timeout: 20_000 });
  } catch (error) {
    if (error instanceof ProductionAdminBootstrapError) {
      throw error;
    }
    throw new ProductionAdminBootstrapError(classifyProductionAdminFailure(error));
  }
}

async function main(): Promise<void> {
  assertProductionBootstrapEnabled(process.env);
  assertNoCredentialArguments(process.argv.slice(2));
  assertCertificateVerifiedConnection(process.env.DATABASE_URL, process.env.DATABASE_SSL_CA);
  const answers = await promptProductionAdmin();
  const prisma = new PrismaService();
  try {
    await runProductionAdminBootstrap(prisma, answers.input, answers.confirmation, {
      connect: () => prisma.onModuleInit(),
    });
    stdout.write(`${PRODUCTION_ADMIN_CREATED_MESSAGE}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

async function promptProductionAdmin(): Promise<{ input: ProductionAdminInput; confirmation: string }> {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new ProductionAdminBootstrapError(
      'Run this from an interactive terminal. Credentials are not accepted as arguments.',
    );
  }
  const email = await ask('Administrator email: ');
  const phone = await ask('Administrator Zimbabwe mobile: ');
  const fullName = await ask('Administrator full name: ');
  const password = await askSecret('Administrator password: ');
  const confirmation = await ask('Type CREATE PRODUCTION ADMIN to continue: ');
  return {
    input: { email, phone, fullName, password },
    confirmation,
  };
}

function ask(prompt: string): Promise<string> {
  const prompts = createInterface({ input: stdin, output: stdout });
  return prompts.question(prompt).finally(() => {
    prompts.close();
  });
}

function askSecret(prompt: string): Promise<string> {
  if (typeof stdin.setRawMode !== 'function') {
    return Promise.reject(new ProductionAdminBootstrapError(
      'This terminal cannot hide the administrator password',
    ));
  }
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: ProductionAdminBootstrapError) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      if (error) {
        reject(error);
        return;
      }
      stdout.write('\n');
      resolve(value);
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\u0003') {
          finish(new ProductionAdminBootstrapError('Production administrator bootstrap cancelled'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= ' ') {
          value += character;
        }
      }
    };
    stdin.on('data', onData);
  });
}

async function hashProductionPassword(password: string, hashPassword: PasswordHasher): Promise<string> {
  try {
    return await hashPassword(password);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'Admin password must contain 12 to 128 characters') {
      throw new ProductionAdminBootstrapError(message);
    }
    throw new ProductionAdminBootstrapError('Administrator password was rejected');
  }
}

function connectionHost(databaseUrl: string, config: PoolConfig): string {
  if (typeof config.host === 'string' && config.host.length > 0) {
    return config.host;
  }
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    throw new ProductionAdminBootstrapError('DATABASE_URL could not be parsed');
  }
}

function findBootstrapError(error: unknown): ProductionAdminBootstrapError | undefined {
  const seen = new Set<unknown>();
  const queue = [error];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) {
      continue;
    }
    seen.add(current);
    if (current instanceof ProductionAdminBootstrapError) {
      return current;
    }
    const record = current as Record<string, unknown>;
    if (typeof record.message === 'string' && SAFE_BOOTSTRAP_MESSAGES.has(record.message)) {
      return new ProductionAdminBootstrapError(record.message);
    }
    queue.push(record.cause);
    const meta = asRecord(record.meta);
    const adapter = asRecord(meta?.driverAdapterError);
    queue.push(adapter?.cause);
  }
  return undefined;
}

function databaseCodes(error: unknown): Set<string> {
  const codes = new Set<string>();
  const seen = new Set<unknown>();
  const queue = [error];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) {
      continue;
    }
    seen.add(current);
    const record = current as Record<string, unknown>;
    const code = typeof record.code === 'string' ? record.code : undefined;
    if (code && SAFE_TOKEN.test(code)) {
      codes.add(code);
    }
    const originalCode = typeof record.originalCode === 'string' ? record.originalCode : undefined;
    if (originalCode && SAFE_TOKEN.test(originalCode)) {
      codes.add(originalCode);
    }
    queue.push(record.cause);
    const meta = asRecord(record.meta);
    const adapter = asRecord(meta?.driverAdapterError);
    queue.push(adapter?.cause);
  }
  return codes;
}

function redactedDiagnostic(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  const queue = [error];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) {
      continue;
    }
    seen.add(current);
    const record = current as Record<string, unknown>;
    for (const key of ['message', 'reason', 'originalMessage']) {
      if (typeof record[key] === 'string') {
        parts.push(redactSecrets(record[key]));
      }
    }
    queue.push(record.cause);
    const meta = asRecord(record.meta);
    const adapter = asRecord(meta?.driverAdapterError);
    queue.push(adapter?.cause);
  }
  return parts.join(' ');
}

function containsSecret(value: string): boolean {
  return /postgres(ql)?:\/\//i.test(value)
    || value.includes('://')
    || value.includes('@')
    || /password=/i.test(value)
    || value.includes('$argon2');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

const SAFE_TOKEN = /^[A-Za-z0-9_]{1,64}$/;

const SAFE_BOOTSTRAP_MESSAGES = new Set([
  'An administrator account already exists',
  'That email or phone already belongs to an account and was not changed',
  'The administrator lock query could not be read',
  'The administrator bootstrap lock or transaction did not finish',
  'The administrator password hash does not fit the stored column',
  'The administrator row did not satisfy a database check',
  'A required administrator field was missing',
  'The administrator role or account status was rejected by the database',
  'The database schema does not match this bootstrap',
]);

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  const base = path.basename(entry);
  return base === 'bootstrap-production-admin.js' || base === 'bootstrap-production-admin.ts';
}

if (isDirectRun()) {
  main().catch((error: unknown) => {
    console.error(publicProductionAdminError(error));
    process.exitCode = 1;
  });
}
