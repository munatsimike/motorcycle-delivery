import { describe, expect, it, vi } from 'vitest';

vi.mock('../../deliveries/data/recentDeliveryStore', () => ({
  loadCustomerIdentity: () => Promise.resolve(null),
  saveCustomerIdentity: () => Promise.resolve(),
}));

import type { AuthSession, CompleteRegistrationRequest, LoginStart, PendingOtp } from './auth.types';
import {
  requestCreateAccountCode,
  requestSignInCode,
  restoreCustomerSession,
  submitCustomerRegistration,
  submitVerificationCode,
} from './customerAuthJourney';
import type { CustomerAuthRepository } from './repositories/CustomerAuthRepository';
import type { CustomerSessionStore } from './repositories/CustomerSessionStore';

const session: AuthSession = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  accessTokenExpiresAt: '2026-11-01T12:15:00.000Z',
  refreshTokenExpiresAt: '2026-12-01T12:00:00.000Z',
};

describe('customer account journey', () => {
  it('takes a new customer from create account through the phone, code, and registration form to home', async () => {
    const calls: string[] = [];
    const repo = repository({
      async startWhatsAppRegistration(request) {
        calls.push(`register:${JSON.stringify(request)}`);
        return { status: 'pending' };
      },
      async verifyWhatsAppRegistration() {
        calls.push('verify-registration');
        return { status: 'verified', registrationToken: 'proof-token' };
      },
      async completeWhatsAppRegistration(request) {
        calls.push(`complete:${request.accountKind === 'INDIVIDUAL' ? request.fullName : request.contactName}`);
        return session;
      },
    });

    const phone = await requestCreateAccountCode(repo, '0771234567');
    const verified = await submitVerificationCode(repo, 'whatsapp_registration', phone, '123456');
    expect(verified.destination).toBe('registration');
    if (verified.destination !== 'registration') {
      return;
    }
    const signedIn = await submitCustomerRegistration(repo, profile(verified.registrationToken));

    expect(phone).toBe('+263771234567');
    expect(calls).toEqual([
      'register:{"phone":"+263771234567","whatsappConsent":true}',
      'verify-registration',
      'complete:Tendai Moyo',
    ]);
    expect(signedIn).toEqual(session);
  });

  it('sends an existing customer who taps create account home after the code', async () => {
    let completed = false;
    const repo = repository({
      async verifyWhatsAppRegistration() {
        return session;
      },
      async completeWhatsAppRegistration() {
        completed = true;
        return session;
      },
    });

    const phone = await requestCreateAccountCode(repo, '0771234567');
    const verified = await submitVerificationCode(repo, 'whatsapp_registration', phone, '123456');

    expect(verified).toEqual({ destination: 'home', session });
    expect(completed).toBe(false);
  });

  it('sends an existing customer from sign in through the code to home', async () => {
    const repo = repository({
      async startWhatsAppLogin() {
        return { status: 'pending' };
      },
      async verifyWhatsAppLogin() {
        return session;
      },
    });

    const started = await requestSignInCode(repo, '0771234567');
    expect(started).toEqual({ status: 'pending', phone: '+263771234567' });
    if (started.status !== 'pending') {
      return;
    }
    await expect(submitVerificationCode(repo, 'whatsapp_login', started.phone, '123456')).resolves.toEqual({
      destination: 'home',
      session,
    });
  });

  it('resumes the registration form when a verified number still has no customer profile', async () => {
    const repo = repository({
      async startWhatsAppLogin() {
        return { status: 'pending' };
      },
      async verifyWhatsAppLogin() {
        return { status: 'verified', registrationToken: 'resume-token', fullName: 'Tendai Moyo' };
      },
    });

    const started = await requestSignInCode(repo, '0771234567');
    expect(started.status).toBe('pending');
    const verified = await submitVerificationCode(repo, 'whatsapp_login', '+263771234567', '123456');

    expect(verified).toEqual({
      destination: 'registration',
      registrationToken: 'resume-token',
      fullName: 'Tendai Moyo',
      address: undefined,
    });
  });

  it('does not grant access when the verification code is rejected', async () => {
    let saved = false;
    const repo = repository({
      async verifyWhatsAppRegistration() {
        throw Object.assign(new Error('Verification code is invalid'), { status: 401 });
      },
    });

    await expect(submitVerificationCode(repo, 'whatsapp_registration', '+263771234567', '000000')).rejects.toThrow(
      'Verification code is invalid',
    );
    expect(saved).toBe(false);
  });

  it('preserves a valid session when the app restarts', async () => {
    const store = memoryStore(session);
    const restored = await restoreCustomerSession(repository(), store, Date.parse('2026-11-01T12:00:00.000Z'));

    expect(restored.status).toBe('ready');
    if (restored.status === 'ready') {
      expect(restored.session).toEqual(session);
    }
    await expect(store.load()).resolves.toEqual(session);
  });
});

function profile(registrationToken: string): CompleteRegistrationRequest {
  return {
    registrationToken,
    accountKind: 'INDIVIDUAL',
    fullName: 'Tendai Moyo',
    address: '12 Samora Machel Avenue',
  };
}

function repository(overrides: Partial<CustomerAuthRepository> = {}): CustomerAuthRepository {
  return {
    startWhatsAppLogin: () => Promise.resolve({ status: 'unavailable' } satisfies LoginStart),
    resendWhatsAppLogin: () => Promise.resolve({ status: 'pending' } satisfies LoginStart),
    verifyWhatsAppLogin: () => Promise.reject(new Error('unused')),
    startWhatsAppRegistration: () => Promise.resolve({ status: 'pending' } satisfies PendingOtp),
    resendWhatsAppRegistration: () => Promise.resolve({ status: 'pending' } satisfies PendingOtp),
    verifyWhatsAppRegistration: () => Promise.reject(new Error('unused')),
    completeWhatsAppRegistration: () => Promise.reject(new Error('unused')),
    refresh: () => Promise.reject(new Error('unused')),
    logout: () => Promise.resolve(),
    ...overrides,
  };
}

function memoryStore(initial: AuthSession | null): CustomerSessionStore {
  let current = initial;
  return {
    load: () => Promise.resolve(current),
    save: (next) => {
      current = next;
      return Promise.resolve();
    },
    clear: () => {
      current = null;
      return Promise.resolve();
    },
  };
}
