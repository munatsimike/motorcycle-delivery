import { apiRequest } from '../api/client';
import {
  readLoginStart,
  readPending,
  readSession,
  readVerification,
  type AuthSession,
  type LoginStart,
  type RegistrationVerification,
} from './contracts';

const LOGOUT_TIMEOUT_MS = 8_000;

export function startWhatsAppLogin(phone: string): Promise<LoginStart> {
  return apiRequest<unknown>('/auth/customer/login/whatsapp', {
    body: { phone, whatsappConsent: true },
  }).then(readLoginStart);
}

export function resendWhatsAppLogin(phone: string): Promise<LoginStart> {
  return apiRequest<unknown>('/auth/customer/login/whatsapp/resend', {
    body: { phone },
  }).then(readLoginStart);
}

export function verifyWhatsAppLogin(phone: string, code: string): Promise<RegistrationVerification> {
  return apiRequest<unknown>('/auth/customer/login/whatsapp/verify', {
    body: { phone, code },
  }).then(readVerification);
}

export function startWhatsAppRegistration(phone: string): Promise<void> {
  return apiRequest<unknown>('/auth/customer/register/whatsapp', {
    body: { phone, whatsappConsent: true },
  }).then(readPending);
}

export function resendWhatsAppRegistration(phone: string): Promise<void> {
  return apiRequest<unknown>('/auth/customer/register/whatsapp/resend', {
    body: { phone },
  }).then(readPending);
}

export function verifyWhatsAppRegistration(phone: string, code: string): Promise<RegistrationVerification> {
  return apiRequest<unknown>('/auth/customer/register/whatsapp/verify', {
    body: { phone, code },
  }).then(readVerification);
}

export function completeWhatsAppRegistration(request: {
  registrationToken: string;
  fullName: string;
  address: string;
}): Promise<AuthSession> {
  return apiRequest<unknown>('/auth/customer/register/whatsapp/complete', {
    body: {
      registrationToken: request.registrationToken,
      accountKind: 'INDIVIDUAL',
      fullName: request.fullName,
      address: request.address,
    },
  }).then(readSession);
}

export function refreshSession(refreshToken: string): Promise<AuthSession> {
  return apiRequest<unknown>('/auth/session/refresh', {
    body: { refreshToken },
  }).then(readSession);
}

export function logoutSession(accessToken: string): Promise<void> {
  return apiRequest<unknown>('/auth/session/logout', {
    body: {},
    accessToken,
    timeoutMs: LOGOUT_TIMEOUT_MS,
  }).then(() => undefined);
}
