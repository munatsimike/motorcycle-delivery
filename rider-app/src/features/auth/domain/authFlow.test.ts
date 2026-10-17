import { describe, expect, it } from 'vitest';

import { readAuthSession, readPendingOtp } from './parseAuth';
import { requestLoginCode } from './usecases/requestLoginCode';
import { requestRegistrationCode } from './usecases/requestRegistrationCode';
import { verifyLoginCode } from './usecases/verifyLoginCode';
import { verifyRegistrationCode } from './usecases/verifyRegistrationCode';
import type { AuthSession, PendingOtp } from './auth.types';
import type { RiderAuthRepository } from './repositories/RiderAuthRepository';

const session: AuthSession = {
  accessToken: 'access-1',
  refreshToken: 'refresh-token-value-1',
  accessTokenExpiresAt: '2026-10-16T16:00:00.000Z',
  refreshTokenExpiresAt: '2026-11-16T15:00:00.000Z',
};

describe('rider authentication flow', () => {
  it('starts registration with the rider phone and name', async () => {
    const calls: Array<{ phone: string; fullName: string }> = [];
    const repository = repositoryWith({
      async requestRegistrationCode(phone, fullName) {
        calls.push({ phone, fullName });
        return { status: 'pending' };
      },
    });

    const started = await requestRegistrationCode(repository, '0771234567', '  Tariro   Moyo ');

    expect(started).toEqual({ phone: '+263771234567', fullName: 'Tariro Moyo' });
    expect(calls).toEqual([{ phone: '+263771234567', fullName: 'Tariro Moyo' }]);
  });

  it('accepts a pending registration response and a session from verify', async () => {
    expect(readPendingOtp({ status: 'pending' })).toEqual({ status: 'pending' });
    expect(readAuthSession(session)).toEqual(session);
    const repository = repositoryWith({
      verifyRegistrationCode: async () => session,
    });

    await expect(verifyRegistrationCode(repository, '+263771234567', '123456')).resolves.toEqual(session);
  });

  it('rejects a registration proof in place of a rider session', () => {
    expect(() => readAuthSession({
      status: 'verified',
      registrationToken: 'registration-proof-token',
    })).toThrow('Authentication failed.');
  });

  it('starts login and verifies the code into a session', async () => {
    const calls: string[] = [];
    const repository = repositoryWith({
      async requestLoginCode(phone) {
        calls.push(phone);
        return { status: 'pending' };
      },
      verifyLoginCode: async () => session,
    });

    await expect(requestLoginCode(repository, '771234567')).resolves.toBe('+263771234567');
    await expect(verifyLoginCode(repository, '+263771234567', '123456')).resolves.toEqual(session);
    expect(calls).toEqual(['+263771234567']);
  });
});

function repositoryWith(overrides: Partial<RiderAuthRepository>): RiderAuthRepository {
  const pending = async (): Promise<PendingOtp> => ({ status: 'pending' });
  return {
    requestRegistrationCode: pending,
    verifyRegistrationCode: async () => session,
    requestLoginCode: pending,
    verifyLoginCode: async () => session,
    refresh: async () => session,
    logout: async () => undefined,
    logoutAll: async () => undefined,
    ...overrides,
  };
}
