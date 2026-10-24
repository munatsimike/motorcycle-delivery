import { describe, expect, it } from 'vitest';

import type { AuthSession, CompleteRegistrationRequest, PendingOtp, RegistrationProof } from '../auth.types';
import type { CustomerAuthRepository } from '../repositories/CustomerAuthRepository';
import { completeRegistration } from './completeRegistration';

const session: AuthSession = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  accessTokenExpiresAt: '2026-10-15T20:00:00.000Z',
  refreshTokenExpiresAt: '2026-11-14T20:00:00.000Z',
};

describe('completeRegistration', () => {
  it('submits the verified profile without a phone number', async () => {
    const repository = fakeRepository();
    await completeRegistration(repository, {
      registrationToken: 'proof-token',
      accountKind: 'BUSINESS',
      businessName: '  Moyo   Deliveries ',
      contactName: 'Tendai Moyo',
      address: '12 Samora Machel Avenue',
    });

    expect(repository.completed).toEqual({
      registrationToken: 'proof-token',
      accountKind: 'BUSINESS',
      businessName: 'Moyo Deliveries',
      contactName: 'Tendai Moyo',
      address: '12 Samora Machel Avenue',
    });
    expect(repository.completed).not.toHaveProperty('phone');
  });

  it('requires the fields for the selected account type', async () => {
    const repository = fakeRepository();
    await expect(completeRegistration(repository, {
      registrationToken: 'proof-token',
      accountKind: 'INDIVIDUAL',
      fullName: '   ',
      address: '1 First Street',
    })).rejects.toThrow('Full name is required.');
    expect(repository.completed).toBeNull();
  });

  it('keeps a long address that is still within the backend limit', async () => {
    const repository = fakeRepository();
    const address = 'A'.repeat(500);
    await completeRegistration(repository, {
      registrationToken: 'proof-token',
      accountKind: 'INDIVIDUAL',
      fullName: 'Rudo Ncube',
      address,
    });
    expect(repository.completed).toMatchObject({ address, fullName: 'Rudo Ncube' });
  });
});

function fakeRepository(): CustomerAuthRepository & { completed: CompleteRegistrationRequest | null } {
  return {
    completed: null,
    requestRegistrationCode(): Promise<PendingOtp> {
      throw new Error('not used');
    },
    requestLoginCode(): Promise<PendingOtp> {
      throw new Error('not used');
    },
    verifyRegistrationCode(): Promise<RegistrationProof> {
      throw new Error('not used');
    },
    verifyLoginCode(): Promise<AuthSession> {
      throw new Error('not used');
    },
    async completeRegistration(request) {
      this.completed = request;
      return session;
    },
    loginWithPassword(): Promise<AuthSession> {
      throw new Error('not used');
    },
    setPassword(): Promise<void> {
      throw new Error('not used');
    },
    registerWithPassword(): Promise<AuthSession> {
      throw new Error('not used');
    },
    startWhatsAppRegistration(): Promise<PendingOtp> {
      throw new Error('not used');
    },
    resendWhatsAppRegistration(): Promise<PendingOtp> {
      throw new Error('not used');
    },
    verifyWhatsAppRegistration(): Promise<AuthSession> {
      throw new Error('not used');
    },
    requestPasswordReset(): Promise<PendingOtp> {
      throw new Error('not used');
    },
    resetPassword(): Promise<void> {
      throw new Error('not used');
    },
    refresh(): Promise<AuthSession> {
      throw new Error('not used');
    },
    logout(): Promise<void> {
      throw new Error('not used');
    },
  };
}
