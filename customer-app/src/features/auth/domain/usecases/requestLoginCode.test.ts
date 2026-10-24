import { describe, expect, it } from 'vitest';

import type { CustomerAuthRepository } from '../repositories/CustomerAuthRepository';
import { requestLoginCode } from './requestLoginCode';

describe('requestLoginCode', () => {
  it('returns the phone only when a sign-in code can be sent', async () => {
    const repository = repositoryReturning({ status: 'pending' });
    await expect(requestLoginCode(repository, '0771234567')).resolves.toEqual({
      status: 'pending',
      phone: '+263771234567',
    });
  });

  it('does not return a phone when this number has no customer account', async () => {
    const repository = repositoryReturning({ status: 'unavailable' });
    await expect(requestLoginCode(repository, '0771234567')).resolves.toEqual({ status: 'unavailable' });
  });
});

function repositoryReturning(started: { status: 'pending' | 'unavailable' }): CustomerAuthRepository {
  return {
    requestRegistrationCode: () => Promise.reject(new Error('unused')),
    requestLoginCode: () => Promise.resolve(started),
    verifyRegistrationCode: () => Promise.reject(new Error('unused')),
    verifyLoginCode: () => Promise.reject(new Error('unused')),
    completeRegistration: () => Promise.reject(new Error('unused')),
    loginWithPassword: () => Promise.reject(new Error('unused')),
    setPassword: () => Promise.reject(new Error('unused')),
    registerWithPassword: () => Promise.reject(new Error('unused')),
    startWhatsAppRegistration: () => Promise.reject(new Error('unused')),
    resendWhatsAppRegistration: () => Promise.reject(new Error('unused')),
    verifyWhatsAppRegistration: () => Promise.reject(new Error('unused')),
    requestPasswordReset: () => Promise.reject(new Error('unused')),
    resetPassword: () => Promise.reject(new Error('unused')),
    refresh: () => Promise.reject(new Error('unused')),
    logout: () => Promise.reject(new Error('unused')),
  };
}
