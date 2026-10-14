import { BadRequestException } from '@nestjs/common';

export type AdminLoginRequest = {
  email: string;
  password: string;
};

export type AdminVerifyRequest = {
  challengeId: string;
  code: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseAdminLoginRequest(body: unknown): AdminLoginRequest {
  if (!isRecord(body)) {
    throw new BadRequestException('Invalid login request');
  }

  const { email, password } = body;

  if (
    typeof email !== 'string' ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    typeof password !== 'string' ||
    password.length === 0 ||
    password.length > 128
  ) {
    throw new BadRequestException('Invalid login request');
  }

  return {
    email: email.toLowerCase(),
    password,
  };
}

export function parseAdminVerifyRequest(body: unknown): AdminVerifyRequest {
  if (!isRecord(body)) {
    throw new BadRequestException('Invalid verification request');
  }

  const { challengeId, code } = body;

  if (
    typeof challengeId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(challengeId) ||
    typeof code !== 'string' ||
    !/^\d{6}$/.test(code)
  ) {
    throw new BadRequestException('Invalid verification request');
  }

  return { challengeId, code };
}
