import { X509Certificate } from 'node:crypto';
import { parse } from 'pg-connection-string';
import type { PoolConfig } from 'pg';

const SAFE_TOKEN = /^[A-Za-z0-9_]{1,64}$/;
const PRISMA_CODE = /^P[0-9]{4}$/;
const SAFE_REASON = /^[A-Za-z0-9_ .,:'()[\]/-]+$/;
const SSL_QUERY_PARAMETERS = ['sslmode', 'ssl', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat'];

export function readDatabaseSslCa(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }

  const pem = normalizePem(value);
  if (pem === '') {
    return undefined;
  }
  if (/-----BEGIN (?!CERTIFICATE-----)/.test(pem)) {
    throw new Error('DATABASE_SSL_CA is not a PEM certificate');
  }

  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\sA-Za-z0-9+/=]+-----END CERTIFICATE-----/g);
  const leftover = pem.replace(/-----BEGIN CERTIFICATE-----[\sA-Za-z0-9+/=]+-----END CERTIFICATE-----/g, '').trim();
  if (!blocks || blocks.length === 0 || leftover !== '') {
    throw new Error('DATABASE_SSL_CA is not a PEM certificate');
  }

  return blocks.map((block) => validateCertificate(block)).join('');
}

function validateCertificate(block: string): string {
  const body = block
    .replace('-----BEGIN CERTIFICATE-----', '')
    .replace('-----END CERTIFICATE-----', '')
    .replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(body)) {
    throw new Error('DATABASE_SSL_CA is not a PEM certificate');
  }
  const lines = body.match(/.{1,64}/g);
  if (!lines) {
    throw new Error('DATABASE_SSL_CA is not a PEM certificate');
  }
  const certificate = `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
  try {
    const parsed = new X509Certificate(certificate);
    if (parsed.raw.length === 0) {
      throw new Error('DATABASE_SSL_CA is not a PEM certificate');
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'DATABASE_SSL_CA is not a PEM certificate') {
      throw error;
    }
    throw new Error('DATABASE_SSL_CA is not a PEM certificate');
  }
  return certificate;
}

// pg replaces an explicit ssl object when connectionString still contains sslmode.
export function databasePoolConfig(databaseUrl: string, sslCa: string | undefined): PoolConfig {
  const certificate = readDatabaseSslCa(sslCa);
  if (certificate === undefined) {
    return { connectionString: databaseUrl };
  }

  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(connectionStringWithoutSsl(databaseUrl));
  } catch (error) {
    if (error instanceof Error && error.message === 'DATABASE_URL could not be parsed') {
      throw error;
    }
    throw new Error('DATABASE_URL could not be parsed');
  }

  if (!parsed.host || !parsed.database) {
    throw new Error('DATABASE_URL is missing a host or database');
  }

  const port = parsed.port == null || parsed.port === '' ? undefined : Number(parsed.port);
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error('DATABASE_URL has an invalid port');
  }

  return {
    host: parsed.host,
    ...(port === undefined ? {} : { port }),
    ...(parsed.user ? { user: parsed.user } : {}),
    ...(parsed.password ? { password: parsed.password } : {}),
    database: parsed.database,
    ssl: {
      ca: certificate,
      rejectUnauthorized: true,
    },
  };
}

export function describeDatabaseError(error: unknown, summary: string): string {
  const record = asRecord(error);
  const cause = readCause(record);
  const code = readSafeToken(record?.code);
  const prismaCode = code !== undefined && PRISMA_CODE.test(code) ? code : undefined;
  const category = readSafeToken(cause?.kind) ?? (prismaCode === undefined ? code : undefined);
  const driverCode = readSafeToken(cause?.originalCode);
  const reason = sanitizeReason(cause?.reason);
  const parts = [prismaCode === undefined ? summary : `${summary} (${prismaCode})`];
  if (category !== undefined) {
    parts.push(`category=${category}`);
  }
  if (driverCode !== undefined && driverCode !== category) {
    parts.push(`driverCode=${driverCode}`);
  }
  if (reason !== undefined) {
    parts.push(`reason=${reason}`);
  }
  return parts.join(' ');
}

export function redactSecrets(value: string): string {
  return value
    .replace(/\b(?:postgres|postgresql):\/\/\S+/gi, '[redacted]')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[redacted]')
    .replace(/\bpassword=[^\s&]+/gi, 'password=[redacted]');
}

function connectionStringWithoutSsl(databaseUrl: string): string {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL could not be parsed');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL could not be parsed');
  }
  for (const name of SSL_QUERY_PARAMETERS) {
    url.searchParams.delete(name);
  }
  return url.toString();
}

function normalizePem(value: string): string {
  const trimmed = value.trim();
  const withNewlines = trimmed.includes('\n')
    ? trimmed
    : trimmed.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n');
  return withNewlines.replace(/\r\n/g, '\n').trim();
}

function readCause(record: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!record) {
    return undefined;
  }
  const meta = asRecord(record.meta);
  const adapter = asRecord(meta?.driverAdapterError);
  const adapterCause = asRecord(adapter?.cause);
  if (adapterCause) {
    return adapterCause;
  }
  const cause = asRecord(record.cause);
  if (cause && (typeof cause.kind === 'string' || typeof cause.reason === 'string' || typeof cause.originalCode === 'string')) {
    return cause;
  }
  return undefined;
}

function sanitizeReason(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const redacted = redactSecrets(value).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 180);
  if (redacted.length === 0 || !SAFE_REASON.test(redacted)) {
    return undefined;
  }
  return redacted;
}

function readSafeToken(value: unknown): string | undefined {
  if (typeof value !== 'string' || !SAFE_TOKEN.test(value)) {
    return undefined;
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>;
  }
  return undefined;
}
