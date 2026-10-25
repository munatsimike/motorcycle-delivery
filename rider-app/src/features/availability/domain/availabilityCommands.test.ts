import { describe, expect, it } from 'vitest';

import { ApiError } from '../../auth/domain/apiError';
import type { AuthSession } from '../../auth/domain/auth.types';
import type { RiderAuthRepository } from '../../auth/domain/repositories/RiderAuthRepository';
import type { RiderSessionStore } from '../../auth/domain/repositories/RiderSessionStore';
import { RiderSessionGate } from '../../auth/domain/sessionGate';
import type { RiderOnboarding } from '../../onboarding/domain/riderOnboarding';
import { goOffline, goOnline, type AvailabilityRepository, type AvailabilitySharing, type LocationPreparer } from './availabilityCommands';
import type { GpsFix } from './gpsFix';

const fix: GpsFix = { latitude: -17.8292, longitude: 31.0522 };

const onboarding: RiderOnboarding = {
  licenceVerificationStatus: 'VERIFIED',
  approvalStatus: 'APPROVED',
  availability: 'OFFLINE',
  licenceNumber: null,
  licenceClass: null,
  rejectionReason: null,
  verifiedMotorcycleCount: 1,
  activeVerifiedMotorcycle: true,
};

describe('rider availability commands', () => {
  it('goes online only after a real fix is uploaded', async () => {
    const calls: string[] = [];
    const result = await goOnline(
      onboarding,
      gate(),
      repository(calls),
      location({ access: 'granted', fix }),
      sharing(calls),
    );

    expect(result).toEqual({ status: 'online' });
    expect(calls).toEqual(['online', 'upload', 'start']);
  });

  it('does not call the server when an unapproved rider tries to go online', async () => {
    const calls: string[] = [];
    const result = await goOnline(
      { ...onboarding, approvalStatus: 'PENDING' },
      gate(),
      repository(calls),
      location({ access: 'granted', fix }),
      sharing(calls),
    );

    expect(result.status).toBe('blocked');
    expect(calls).toEqual([]);
  });

  it('stays offline when location permission is denied', async () => {
    const calls: string[] = [];
    const result = await goOnline(
      onboarding,
      gate(),
      repository(calls),
      location({ access: 'permission-blocked', fix: null }),
      sharing(calls),
    );

    expect(result.status).toBe('location');
    expect(calls).toEqual([]);
  });

  it('stays offline when device location is switched off', async () => {
    const calls: string[] = [];
    const result = await goOnline(
      onboarding,
      gate(),
      repository(calls),
      location({ access: 'services-off', fix: null }),
      sharing(calls),
    );

    expect(result.status).toBe('location');
    if (result.status === 'location') {
      expect(result.message).toContain('Turn on your device location');
    }
    expect(calls).toEqual([]);
  });

  it('returns to offline when the first location upload fails', async () => {
    const calls: string[] = [];
    const result = await goOnline(
      onboarding,
      gate(),
      repository(calls),
      location({ access: 'granted', fix }),
      sharing(calls, { failUpload: true }),
    );

    expect(result).toMatchObject({ status: 'offline', availability: 'OFFLINE' });
    expect(calls).toEqual(['online', 'upload', 'offline']);
  });

  it('does not confirm offline when the rollback request fails', async () => {
    const calls: string[] = [];
    const result = await goOnline(
      onboarding,
      gate(),
      repository(calls, { failOffline: true }),
      location({ access: 'granted', fix }),
      sharing(calls, { failUpload: true }),
    );

    expect(result.status).toBe('unconfirmed');
    if (result.status === 'unconfirmed') {
      expect(result.message).toContain('could not be confirmed');
    }
    expect(calls).toEqual(['online', 'upload', 'offline']);
  });

  it('shows the server refusal for a busy rider', async () => {
    const calls: string[] = [];
    const result = await goOnline(
      onboarding,
      gate(),
      repository(calls, { onlineStatus: 409, onlineMessage: 'Availability cannot be changed while busy' }),
      location({ access: 'granted', fix }),
      sharing(calls),
    );

    expect(result).toEqual({
      status: 'refused',
      message: 'Availability cannot be changed while busy',
    });
    expect(calls).toEqual(['online']);
  });

  it('does not confirm offline when going offline fails', async () => {
    const calls: string[] = [];
    const result = await goOffline(
      { ...onboarding, availability: 'AVAILABLE' },
      gate(),
      repository(calls, { failOffline: true }),
      sharing(calls),
    );

    expect(result.status).toBe('unconfirmed');
    expect(calls).toEqual(['stop', 'offline']);
  });

  it('confirms offline only from the server response', async () => {
    const calls: string[] = [];
    const result = await goOffline(
      { ...onboarding, availability: 'AVAILABLE' },
      gate(),
      repository(calls),
      sharing(calls),
    );

    expect(result).toMatchObject({ status: 'offline', availability: 'OFFLINE' });
    expect(calls).toEqual(['stop', 'offline']);
  });
});

function gate(): RiderSessionGate {
  return new RiderSessionGate(unusedAuth(), memoryStore({
    accessToken: 'access-1',
    refreshToken: 'refresh-token-1',
    accessTokenExpiresAt: '2099-10-16T16:00:00.000Z',
    refreshTokenExpiresAt: '2026-11-16T15:00:00.000Z',
  }));
}

function location(prepared: Awaited<ReturnType<LocationPreparer['prepare']>>): LocationPreparer {
  return { prepare: async () => prepared };
}

function sharing(calls: string[], options: { failUpload?: boolean } = {}): AvailabilitySharing {
  return {
    async uploadNow() {
      calls.push('upload');
      if (options.failUpload) {
        throw new Error('network');
      }
    },
    async start() {
      calls.push('start');
    },
    async stop() {
      calls.push('stop');
    },
  };
}

function repository(
  calls: string[],
  options: { failOffline?: boolean; onlineStatus?: number; onlineMessage?: string } = {},
): AvailabilityRepository {
  return {
    async online() {
      calls.push('online');
      if (options.onlineStatus) {
        throw new ApiError(options.onlineMessage ?? 'Request failed', options.onlineStatus);
      }
      return { availability: 'AVAILABLE', message: null };
    },
    async offline() {
      calls.push('offline');
      if (options.failOffline) {
        throw new Error('network');
      }
      return { availability: 'OFFLINE', message: null };
    },
  };
}

function memoryStore(initial: AuthSession): RiderSessionStore {
  let current: AuthSession | null = initial;
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

function unusedAuth(): RiderAuthRepository {
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
  };
}
