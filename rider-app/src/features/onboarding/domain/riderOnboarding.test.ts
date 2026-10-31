import { describe, expect, it } from 'vitest';

import { ApiError } from '../../auth/domain/apiError';
import type { AuthSession } from '../../auth/domain/auth.types';
import type { RiderAuthRepository } from '../../auth/domain/repositories/RiderAuthRepository';
import type { RiderSessionStore } from '../../auth/domain/repositories/RiderSessionStore';
import { RiderSessionGate } from '../../auth/domain/sessionGate';
import { loadRiderOnboarding } from './loadRiderOnboarding';
import { readRiderOnboarding, riderReadiness, type RiderOnboarding } from './riderOnboarding';

const onboarding: RiderOnboarding = {
  licenceVerificationStatus: 'PENDING',
  approvalStatus: 'PENDING',
  availability: 'OFFLINE',
  licenceNumber: null,
  licenceClass: null,
  rejectionReason: null,
  verifiedMotorcycleCount: 0,
  activeVerifiedMotorcycle: false,
};

describe('rider onboarding status', () => {
  it('reads the onboarding payload', () => {
    expect(readRiderOnboarding(onboarding)).toEqual(onboarding);
    expect(() => readRiderOnboarding({ ...onboarding, approvalStatus: 'ONLINE' })).toThrow(
      'Rider status could not be loaded.',
    );
  });

  it('keeps an unapproved rider offline and unable to accept work', () => {
    const readiness = riderReadiness({ ...onboarding, availability: 'AVAILABLE' });
    expect(readiness.canAcceptDeliveries).toBe(false);
    expect(readiness.availabilityLabel).toBe('Offline');
    expect(readiness.approvalLabel).toBe('Pending');
    expect(readiness.message).toContain('waiting for approval');
  });

  it('explains a busy rider cannot change availability', () => {
    const readiness = riderReadiness({
      ...onboarding,
      licenceVerificationStatus: 'VERIFIED',
      approvalStatus: 'APPROVED',
      activeVerifiedMotorcycle: true,
      availability: 'BUSY',
    });
    expect(readiness.availabilityLabel).toBe('Online');
    expect(readiness.message).toContain('online');
  });

  it('explains a ready rider who is still offline', () => {
    const readiness = riderReadiness({
      ...onboarding,
      licenceVerificationStatus: 'VERIFIED',
      approvalStatus: 'APPROVED',
      activeVerifiedMotorcycle: true,
      availability: 'OFFLINE',
    });
    expect(readiness.canAcceptDeliveries).toBe(false);
    expect(readiness.availabilityLabel).toBe('Offline');
    expect(readiness.message).toContain('offline');
  });

  it('loads onboarding with the current access token', async () => {
    const stored = session('access-1');
    const gate = new RiderSessionGate(unusedAuth(), memoryStore(stored));
    const seen: string[] = [];

    const loaded = await loadRiderOnboarding(gate, {
      async load(accessToken) {
        seen.push(accessToken);
        return onboarding;
      },
    });

    expect(loaded.approvalStatus).toBe('PENDING');
    expect(seen).toEqual(['access-1']);
  });

  it('does not keep showing status after the session is rejected', async () => {
    const gate = new RiderSessionGate(unusedAuth({
      refresh: async () => {
        throw new ApiError('Authentication failed', 401);
      },
    }), memoryStore(session('access-1', '2000-01-01T00:00:00.000Z')));

    await expect(loadRiderOnboarding(gate, {
      load: async () => onboarding,
    })).rejects.toThrow('Your session has ended. Sign in again.');
  });
});

function session(accessToken: string, accessTokenExpiresAt = '2099-10-16T16:00:00.000Z'): AuthSession {
  return {
    accessToken,
    refreshToken: 'refresh-token-1',
    accessTokenExpiresAt,
    refreshTokenExpiresAt: '2026-11-16T15:00:00.000Z',
  };
}

function memoryStore(initial: AuthSession | null): RiderSessionStore {
  let current = initial;
  return {
    async load() {
      return current;
    },
    async save(next) {
      current = next;
    },
    async clear() {
      current = null;
    },
  };
}

function unusedAuth(overrides: Partial<RiderAuthRepository> = {}): RiderAuthRepository {
  const unused = async () => {
    throw new Error('Unexpected auth call');
  };
  return {
    requestRegistrationCode: unused,
    resendRegistrationCode: unused,
    verifyRegistrationCode: unused,
    requestLoginCode: unused,
    resendLoginCode: unused,
    verifyLoginCode: unused,
    refresh: unused,
    logout: async () => undefined,
    logoutAll: async () => undefined,
    ...overrides,
  };
}
