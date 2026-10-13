import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { UserRole } from '../generated/prisma/client.js';
import { ACCESS_TOKEN_TTL_SECONDS } from './auth.constants.js';

const CLOCK_SKEW_MS = 5_000;
const MAX_TOKEN_LENGTH = 4096;

export type AccessTokenClaims = {
  sub: string;
  role: UserRole;
  sid: string;
};

type JsonRecord = Record<string, unknown>;

@Injectable()
export class AccessTokenService {
  sign(claims: AccessTokenClaims, now = new Date()): { token: string; expiresAt: Date } {
    const issuedAt = Math.floor(now.getTime() / 1000);
    const expiresAtSeconds = issuedAt + this.ttlSeconds();
    const header = base64UrlJson({ alg: 'HS256', typ: 'JWT' });
    const payload = base64UrlJson({
      sub: claims.sub,
      role: claims.role,
      sid: claims.sid,
      iat: issuedAt,
      exp: expiresAtSeconds,
    });
    const unsigned = `${header}.${payload}`;
    return {
      token: `${unsigned}.${signPart(unsigned, this.secret())}`,
      expiresAt: new Date(expiresAtSeconds * 1000),
    };
  }

  verify(
    token: string,
    now = new Date(),
    options?: { ignoreExpiration?: boolean },
  ): AccessTokenClaims {
    if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
      throw new UnauthorizedException('Authentication failed');
    }
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Authentication failed');
    }
    const [headerPart, payloadPart, signaturePart] = parts;
    if (!headerPart || !payloadPart || !signaturePart) {
      throw new UnauthorizedException('Authentication failed');
    }

    const expected = signPart(`${headerPart}.${payloadPart}`, this.secret());
    const actualBuffer = Buffer.from(signaturePart);
    const expectedBuffer = Buffer.from(expected);
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException('Authentication failed');
    }

    const header = decodeJson(headerPart);
    if (header.alg !== 'HS256' || header.typ !== 'JWT') {
      throw new UnauthorizedException('Authentication failed');
    }
    const payload = decodeJson(payloadPart);
    if (!isRole(payload.role) || typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
      throw new UnauthorizedException('Authentication failed');
    }
    if (typeof payload.exp !== 'number') {
      throw new UnauthorizedException('Authentication failed');
    }
    if (
      !options?.ignoreExpiration &&
      payload.exp * 1000 + CLOCK_SKEW_MS <= now.getTime()
    ) {
      throw new UnauthorizedException('Authentication failed');
    }
    return { sub: payload.sub, role: payload.role, sid: payload.sid };
  }

  private secret(): string {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error('JWT_ACCESS_SECRET must be at least 32 characters');
    }
    return secret;
  }

  private ttlSeconds(): number {
    const raw = process.env.JWT_ACCESS_TTL_SECONDS;
    if (!raw) {
      return ACCESS_TOKEN_TTL_SECONDS;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 60 || parsed > 3600) {
      return ACCESS_TOKEN_TTL_SECONDS;
    }
    return parsed;
  }
}

export function readBearerToken(header: string | undefined): string {
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedException('Authentication failed');
  }
  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    throw new UnauthorizedException('Authentication failed');
  }
  return token;
}

function signPart(unsigned: string, secret: string): string {
  return createHmac('sha256', secret).update(unsigned).digest('base64url');
}

function base64UrlJson(value: JsonRecord): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeJson(value: string): JsonRecord {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new UnauthorizedException('Authentication failed');
    }
    return parsed as JsonRecord;
  } catch (error) {
    if (error instanceof UnauthorizedException) {
      throw error;
    }
    throw new UnauthorizedException('Authentication failed');
  }
}

function isRole(value: unknown): value is UserRole {
  return value === 'CUSTOMER' || value === 'RIDER' || value === 'ADMIN';
}
