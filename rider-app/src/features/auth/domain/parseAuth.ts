import type { AuthSession, PendingOtp } from './auth.types';

export function readPendingOtp(value: unknown): PendingOtp {
  if (!isRecord(value) || value.status !== 'pending') {
    throw new Error('Verification could not be started.');
  }
  return { status: 'pending' };
}

export function readAuthSession(value: unknown): AuthSession {
  if (!isRecord(value) || 'registrationToken' in value) {
    throw new Error('Authentication failed.');
  }
  const accessToken = textField(value.accessToken);
  const refreshToken = textField(value.refreshToken);
  const accessTokenExpiresAt = textField(value.accessTokenExpiresAt);
  const refreshTokenExpiresAt = textField(value.refreshTokenExpiresAt);
  if (!accessToken || !refreshToken || !accessTokenExpiresAt || !refreshTokenExpiresAt) {
    throw new Error('Authentication failed.');
  }
  return { accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt };
}

function textField(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
