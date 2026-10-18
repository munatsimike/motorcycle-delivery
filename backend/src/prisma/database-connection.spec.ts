import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { PoolConfig } from 'pg';
import { databasePoolConfig, describeDatabaseError, readDatabaseSslCa } from './database-connection.js';

const require = createRequire(import.meta.url);
const ConnectionParameters = require('pg/lib/connection-parameters.js') as new (config: PoolConfig) => {
  ssl?: {
    ca?: string;
    rejectUnauthorized?: boolean;
    checkServerIdentity?: () => void;
  };
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
};

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

const databaseUrl = 'postgresql://app:p%40ssword@db.example:5432/delivery?sslmode=require&uselibpqcompat=true';

describe('database TLS configuration', () => {
  it('gives PrismaPg separate fields and verifies the supplied CA', async () => {
    const warnings: string[] = [];
    const listener = (warning: Error) => {
      warnings.push(warning.message);
    };
    process.on('warning', listener);
    const config = databasePoolConfig(databaseUrl, ROOT_CA);
    const connection = new ConnectionParameters(config);
    await new Promise((resolve) => setImmediate(resolve));
    process.removeListener('warning', listener);

    const service = readFileSync(new URL('./prisma.service.ts', import.meta.url), 'utf8');
    expect(service).toContain('databasePoolConfig(loadDatabaseUrl(), process.env.DATABASE_SSL_CA)');
    expect(service).toContain('new PrismaPg(');
    expect(service).not.toContain('rejectUnauthorized: false');
    expect(service).not.toContain('checkServerIdentity');

    expect(config).not.toHaveProperty('connectionString');
    expect(config.host).toBe('db.example');
    expect(config.port).toBe(5432);
    expect(config.user).toBe('app');
    expect(config.password).toBe('p@ssword');
    expect(config.database).toBe('delivery');
    expect(config.ssl).toEqual({
      ca: readDatabaseSslCa(ROOT_CA),
      rejectUnauthorized: true,
    });
    expect(config.ssl).not.toHaveProperty('checkServerIdentity');
    expect(connection.ssl?.rejectUnauthorized).toBe(true);
    expect(connection.ssl?.ca).toBe(readDatabaseSslCa(ROOT_CA));
    expect(connection.ssl?.checkServerIdentity).toBeUndefined();
    expect(connection.host).toBe('db.example');
    expect(connection.password).toBe('p@ssword');
    expect(warnings.join('\n')).not.toContain('SECURITY WARNING');
  });

  it('accepts a certificate whose newlines were escaped', () => {
    const escaped = ROOT_CA.replace(/\n/g, '\\n');
    const config = databasePoolConfig(databaseUrl, escaped);
    expect(config.ssl).toMatchObject({ rejectUnauthorized: true });
    expect(readDatabaseSslCa(escaped)).toBe(readDatabaseSslCa(ROOT_CA));
  });

  it('keeps the local connection string when no CA is configured', () => {
    const localUrl = 'postgresql://USER:PASSWORD@localhost:5432/delivery_db';
    expect(readDatabaseSslCa(undefined)).toBeUndefined();
    expect(readDatabaseSslCa('')).toBeUndefined();
    expect(readDatabaseSslCa('   ')).toBeUndefined();
    expect(databasePoolConfig(localUrl, undefined)).toEqual({ connectionString: localUrl });
    expect(databasePoolConfig(localUrl, ' \n ')).toEqual({ connectionString: localUrl });
  });

  it('rejects a malformed CA without falling back or exposing it', () => {
    const malformed = [
      'not-a-certificate',
      '-----BEGIN PRIVATE KEY-----\npostgresql://app:s3cret@db.example:5432/delivery\n-----END PRIVATE KEY-----',
      '-----BEGIN CERTIFICATE-----\nbad-certificate\n-----END CERTIFICATE-----',
      `${ROOT_CA}\npostgresql://app:s3cret@db.example:5432/delivery`,
    ];

    for (const value of malformed) {
      expect(() => databasePoolConfig(databaseUrl, value)).toThrow('DATABASE_SSL_CA is not a PEM certificate');
      try {
        databasePoolConfig(databaseUrl, value);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toContain('s3cret');
        expect(message).not.toContain('p@ssword');
        expect(message).not.toContain('postgresql://');
        expect(message).not.toContain('BEGIN');
      }
    }
  });

  it('rejects an unusable database URL without exposing credentials', () => {
    const urls = [
      'http://app:s3cret@db.example:5432/delivery',
      'postgresql://app:s3cret@/delivery',
    ];
    for (const url of urls) {
      expect(() => databasePoolConfig(url, ROOT_CA)).toThrow(/DATABASE_URL/);
      try {
        databasePoolConfig(url, ROOT_CA);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toContain('s3cret');
        expect(message).not.toContain('postgresql://');
        expect(message).not.toContain('http://');
      }
    }
  });

  it('logs the Prisma code and TLS category without credentials', () => {
    const secretUrl = 'postgresql://app:s3cret@db.example:5432/delivery?sslmode=require';
    const detail = describeDatabaseError({
      code: 'P2010',
      message: `Raw query failed ${secretUrl}`,
      meta: {
        driverAdapterError: {
          cause: {
            kind: 'TlsConnectionError',
            reason: `self-signed certificate in certificate chain ${secretUrl}`,
            originalMessage: `password=s3cret ${secretUrl}`,
            originalCode: 'SELF_SIGNED_CERT_IN_CHAIN',
          },
        },
      },
    }, 'Database connectivity check failed');

    expect(detail).toContain('Database connectivity check failed (P2010)');
    expect(detail).toContain('category=TlsConnectionError');
    expect(detail).toContain('driverCode=SELF_SIGNED_CERT_IN_CHAIN');
    expect(detail).toContain('reason=self-signed certificate in certificate chain [redacted]');
    expect(detail).not.toContain('s3cret');
    expect(detail).not.toContain('db.example');
    expect(detail).not.toContain('postgresql://');
    expect(detail).not.toContain('password=s3cret');
  });

  it('logs a pool TLS error category without the raw message', () => {
    const detail = describeDatabaseError({
      code: 'SELF_SIGNED_CERT_IN_CHAIN',
      message: 'postgresql://app:s3cret@db.example:5432/delivery',
    }, 'PostgreSQL pool reported a connection error');

    expect(detail).toBe('PostgreSQL pool reported a connection error category=SELF_SIGNED_CERT_IN_CHAIN');
    expect(detail).not.toContain('s3cret');
  });
});
