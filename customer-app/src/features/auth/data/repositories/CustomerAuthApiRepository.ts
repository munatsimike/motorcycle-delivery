import { apiPost } from '../../../../services/api/apiClient';
import type { AuthSession, CompleteRegistrationRequest, LoginStart, PendingOtp, RegistrationVerification } from '../../domain/auth.types';
import type { CustomerAuthRepository, PhoneRegistrationRequest } from '../../domain/repositories/CustomerAuthRepository';

export const SESSION_LOGOUT_TIMEOUT_MS = 8_000;

export class CustomerAuthApiRepository implements CustomerAuthRepository {
  startWhatsAppLogin(phone: string): Promise<LoginStart> {
    return apiPost<unknown>('/auth/customer/login/whatsapp', { phone, whatsappConsent: true }).then(readLoginStart);
  }

  resendWhatsAppLogin(phone: string): Promise<LoginStart> {
    return apiPost<unknown>('/auth/customer/login/whatsapp/resend', { phone }).then(readLoginStart);
  }

  verifyWhatsAppLogin(phone: string, code: string): Promise<RegistrationVerification> {
    return apiPost<unknown>('/auth/customer/login/whatsapp/verify', { phone, code }).then(readVerification);
  }

  startWhatsAppRegistration(request: PhoneRegistrationRequest): Promise<PendingOtp> {
    return apiPost<unknown>('/auth/customer/register/whatsapp', request).then(readPending);
  }

  resendWhatsAppRegistration(phone: string): Promise<PendingOtp> {
    return apiPost<unknown>('/auth/customer/register/whatsapp/resend', { phone }).then(readPending);
  }

  verifyWhatsAppRegistration(phone: string, code: string): Promise<RegistrationVerification> {
    return apiPost<unknown>('/auth/customer/register/whatsapp/verify', { phone, code }).then(readVerification);
  }

  completeWhatsAppRegistration(request: CompleteRegistrationRequest): Promise<AuthSession> {
    return apiPost<unknown>('/auth/customer/register/whatsapp/complete', request).then(readSession);
  }

  refresh(refreshToken: string): Promise<AuthSession> {
    return apiPost<unknown>('/auth/session/refresh', { refreshToken }).then(readSession);
  }

  async logout(accessToken: string): Promise<void> {
    await apiPost<unknown>('/auth/session/logout', {}, {
      accessToken,
      timeoutMs: SESSION_LOGOUT_TIMEOUT_MS,
    });
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

function readVerification(value: unknown): RegistrationVerification {
  if (!isRecord(value)) {
    throw new Error('Authentication failed.');
  }
  if (value.status === 'sign_in') {
    return { status: 'sign_in' };
  }
  const registrationToken = textField(value.registrationToken);
  if (value.status === 'verified' && registrationToken) {
    const fullName = textField(value.fullName) ?? undefined;
    const address = value.address === null ? null : textField(value.address) ?? undefined;
    return { status: 'verified', registrationToken, fullName, address };
  }
  return readSession(value);
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
