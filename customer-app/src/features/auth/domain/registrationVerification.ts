import type { AuthSession, ExistingAccountDetails, RegistrationVerification } from './auth.types';

export function readRegistrationVerification(value: unknown): RegistrationVerification {
  if (!isRecord(value)) {
    throw new Error('Verification failed.');
  }
  const session = readSession(value);
  if (session) {
    return session;
  }
  if (value.status === 'sign_in') {
    return { status: 'sign_in' };
  }
  if (value.status !== 'verified' || typeof value.registrationToken !== 'string' || value.registrationToken.length < 20) {
    throw new Error('Verification failed.');
  }
  const existing = readExistingAccount(value);
  return existing
    ? { status: 'verified', registrationToken: value.registrationToken, existing }
    : { status: 'verified', registrationToken: value.registrationToken };
}

function readExistingAccount(value: Record<string, unknown>): ExistingAccountDetails | undefined {
  if (typeof value.fullName !== 'string' || typeof value.phone !== 'string') {
    return undefined;
  }
  const address = value.address === null ? null : typeof value.address === 'string' ? value.address : undefined;
  if (address === undefined) {
    return undefined;
  }
  return {
    fullName: value.fullName,
    phone: value.phone,
    address,
    readOnly: readOnlyFields(value.readOnly),
    missing: missingFields(value.missing),
  };
}

function readOnlyFields(value: unknown): ExistingAccountDetails['readOnly'] {
  if (!Array.isArray(value)) {
    return ['fullName', 'phone'];
  }
  return value.filter((item): item is 'fullName' | 'phone' | 'address' => item === 'fullName' || item === 'phone' || item === 'address');
}

function missingFields(value: unknown): ExistingAccountDetails['missing'] {
  if (!Array.isArray(value)) {
    return ['accountKind'];
  }
  return value.filter((item): item is 'accountKind' | 'address' => item === 'accountKind' || item === 'address');
}

function readSession(value: Record<string, unknown>): AuthSession | undefined {
  const accessToken = textField(value.accessToken);
  const refreshToken = textField(value.refreshToken);
  const accessTokenExpiresAt = textField(value.accessTokenExpiresAt);
  const refreshTokenExpiresAt = textField(value.refreshTokenExpiresAt);
  if (!accessToken || !refreshToken || !accessTokenExpiresAt || !refreshTokenExpiresAt) {
    return undefined;
  }
  return { accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt };
}

function textField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
