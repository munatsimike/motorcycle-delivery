import { apiPost } from '../../../../services/api/apiClient';
import type { AuthSession, CustomerProfile, LoginStart, PendingOtp } from '../../domain/auth.types';
import type { CustomerAuthRepository } from '../../domain/repositories/CustomerAuthRepository';

export class CustomerAuthApiRepository implements CustomerAuthRepository {
  startWhatsAppLogin(phone: string): Promise<LoginStart> {
    return apiPost<unknown>('/auth/customer/login/whatsapp', { phone, whatsappConsent: true }).then(readLoginStart);
  }

  resendWhatsAppLogin(phone: string): Promise<LoginStart> {
    return apiPost<unknown>('/auth/customer/login/whatsapp/resend', { phone }).then(readLoginStart);
  }

  verifyWhatsAppLogin(phone: string, code: string): Promise<AuthSession> {
    return apiPost<unknown>('/auth/customer/login/whatsapp/verify', { phone, code }).then(readSession);
  }

  startWhatsAppRegistration(request: CustomerProfile & { phone: string; whatsappConsent: true }): Promise<PendingOtp> {
    return apiPost<unknown>('/auth/customer/register/whatsapp', request).then(readPending);
  }

  resendWhatsAppRegistration(phone: string): Promise<PendingOtp> {
    return apiPost<unknown>('/auth/customer/register/whatsapp/resend', { phone }).then(readPending);
  }

  verifyWhatsAppRegistration(phone: string, code: string): Promise<AuthSession> {
    return apiPost<unknown>('/auth/customer/register/whatsapp/verify', { phone, code }).then(readSession);
  }

  refresh(refreshToken: string): Promise<AuthSession> {
    return apiPost<unknown>('/auth/session/refresh', { refreshToken }).then(readSession);
  }

  async logout(accessToken: string): Promise<void> {
    await apiPost<unknown>('/auth/session/logout', {}, { accessToken });
  }
}

export const customerAuthRepository = new CustomerAuthApiRepository();

function readLoginStart(value: unknown): LoginStart {
  if (!isRecord(value)) {
    throw new Error('Verification could not be started.');
  }
  if (value.status === 'pending') {
    return { status: 'pending' };
  }
  if (value.status === 'unavailable') {
    return { status: 'unavailable' };
  }
  throw new Error('Verification could not be started.');
}

function readPending(value: unknown): PendingOtp {
  if (!isRecord(value) || value.status !== 'pending') {
    throw new Error('Verification could not be started.');
  }
  return { status: 'pending' };
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
