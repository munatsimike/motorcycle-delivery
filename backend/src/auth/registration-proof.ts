import { createHmac, timingSafeEqual } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { REGISTRATION_PROOF_TTL_MS } from './auth.constants.js';

const CLOCK_SKEW_MS = 5_000;
const MAX_TOKEN_LENGTH = 4096;
const STORED_PHONE = /^\+(?:2637\d{8}|316\d{8})$/;

export type RegistrationProof = {
  status: 'verified';
  registrationToken: string;
  fullName?: string;
  phone?: string;
  address?: string | null;
  readOnly?: Array<'fullName' | 'phone' | 'address'>;
  missing?: Array<'accountKind' | 'address'>;
};

export type RegistrationProofPurpose = 'customer-registration' | 'rider-registration';

export type RegistrationProofClaims = {
  challengeId: string;
  phone: string;
  purpose: RegistrationProofPurpose;
};

export function signRegistrationProof(
  challengeId: string,
  phone: string,
  now: Date,
  purpose: RegistrationProofPurpose = 'customer-registration',
): string {
  const expiresAtSeconds = Math.floor((now.getTime() + REGISTRATION_PROOF_TTL_MS) / 1000);
  const header = base64UrlJson({ alg: 'HS256', typ: purpose });
  const payload = base64UrlJson({
    cid: challengeId,
    phone,
    purpose,
    exp: expiresAtSeconds,
  });
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${signPart(unsigned, secret())}`;
}

export function readRegistrationProof(
  token: string,
  now = new Date(),
  purpose: RegistrationProofPurpose = 'customer-registration',
): RegistrationProofClaims {
  if (token.length < 20 || token.length > MAX_TOKEN_LENGTH) {
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

  const expected = signPart(`${headerPart}.${payloadPart}`, secret());
  const actualBuffer = Buffer.from(signaturePart);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new UnauthorizedException('Authentication failed');
  }

  const header = decodeJson(headerPart);
  if (header.alg !== 'HS256' || header.typ !== purpose) {
    throw new UnauthorizedException('Authentication failed');
  }
  const payload = decodeJson(payloadPart);
  if (payload.purpose !== purpose || typeof payload.cid !== 'string' || typeof payload.phone !== 'string') {
    throw new UnauthorizedException('Authentication failed');
  }
  if (!STORED_PHONE.test(payload.phone) || typeof payload.exp !== 'number') {
    throw new UnauthorizedException('Authentication failed');
  }
  if (payload.exp * 1000 + CLOCK_SKEW_MS <= now.getTime()) {
    throw new UnauthorizedException('Authentication failed');
  }
  return { challengeId: payload.cid, phone: payload.phone, purpose };
}

function secret(): string {
  const value = process.env.JWT_ACCESS_SECRET;
  if (!value || value.length < 32) {
    throw new Error('JWT_ACCESS_SECRET must be at least 32 characters');
  }
  return value;
}

function signPart(unsigned: string, key: string): string {
  return createHmac('sha256', key).update(unsigned).digest('base64url');
}

function base64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeJson(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new UnauthorizedException('Authentication failed');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof UnauthorizedException) {
      throw error;
    }
    throw new UnauthorizedException('Authentication failed');
  }
}
