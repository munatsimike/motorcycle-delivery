import { apiPost } from '../../../../services/api/apiClient';
import type {
  AuthSession,
  CompleteRegistrationRequest,
  PendingOtp,
  RegistrationProof,
} from '../../domain/auth.types';
import type { CustomerAuthRepository } from '../../domain/repositories/CustomerAuthRepository';

export class CustomerAuthApiRepository implements CustomerAuthRepository {
  requestRegistrationCode(phone: string): Promise<PendingOtp> {
    return apiPost<unknown>('/auth/customer/register', { phone }).then(readPending);
  }

  requestLoginCode(phone: string): Promise<PendingOtp> {
    return apiPost<unknown>('/auth/customer/login', { phone }).then(readPending);
  }

  verifyRegistrationCode(phone: string, code: string): Promise<RegistrationProof> {
    return apiPost<unknown>('/auth/customer/register/verify', { phone, code }).then(readProof);
  }

  verifyLoginCode(phone: string, code: string): Promise<AuthSession> {
    return apiPost<unknown>('/auth/customer/login/verify', { phone, code }).then(readSession);
  }

  completeRegistration(request: CompleteRegistrationRequest): Promise<AuthSession> {
    return apiPost<unknown>('/auth/customer/register/complete', request).then(readSession);
  }

  refresh(refreshToken: string): Promise<AuthSession> {
    return apiPost<unknown>('/auth/session/refresh', { refreshToken }).then(readSession);
  }

  async logout(accessToken: string): Promise<void> {
    await apiPost<unknown>('/auth/session/logout', {}, { accessToken });
  }
}

export const customerAuthRepository = new CustomerAuthApiRepository();

function readPending(value: unknown): PendingOtp {
  if (!isRecord(value) || value.status !== 'pending') {
    throw new Error('Verification could not be started.');
  }
  return { status: 'pending' };
}

function readProof(value: unknown): RegistrationProof {
  if (
    !isRecord(value)
    || value.status !== 'verified'
    || typeof value.registrationToken !== 'string'
    || value.registrationToken.length < 20
    || 'accessToken' in value
  ) {
    throw new Error('Verification failed.');
  }
  return { status: 'verified', registrationToken: value.registrationToken };
}

function readSession(value: unknown): AuthSession {
  if (!isRecord(value)) {
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
