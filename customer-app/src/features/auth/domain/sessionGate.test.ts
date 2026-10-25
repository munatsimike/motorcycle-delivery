import { describe, expect, it, vi } from 'vitest';

vi.mock('../../deliveries/data/recentDeliveryStore', () => ({
  loadCustomerIdentity: () => Promise.resolve(null),
  saveCustomerIdentity: () => Promise.resolve(),
}));

import type { AuthSession } from './auth.types';
import type { CustomerAuthRepository } from './repositories/CustomerAuthRepository';
import type { CustomerSessionStore } from './repositories/CustomerSessionStore';
import { sessionGate } from './sessionGate';
import { logoutCustomer } from './usecases/logoutCustomer';
import { restoreSession } from './usecases/restoreSession';

const now = Date.parse('2026-10-18T18:00:00.000Z');

function session(accessInMs: number, refreshInMs: number): AuthSession {
  return {
    accessToken: 'access-token',
    refreshToken: 'refresh-token-value-0001',
    accessTokenExpiresAt: new Date(now + accessInMs).toISOString(),
    refreshTokenExpiresAt: new Date(now + refreshInMs).toISOString(),
  };
}

function memoryStore(initial: AuthSession | null, biometric = false) {
  let current = initial;
  let biometricEnabled = biometric;
  const store: CustomerSessionStore & {
    saveBiometricEnabled(enabled: boolean): Promise<void>;
    biometricEnabled(): boolean;
  } = {
    load: () => Promise.resolve(current),
    save: (next) => {
      current = next;
      return Promise.resolve();
    },
    clear: () => {
      current = null;
      return Promise.resolve();
    },
    saveBiometricEnabled: (enabled) => {
      biometricEnabled = enabled;
      return Promise.resolve();
    },
    biometricEnabled: () => biometricEnabled,
  };
  return store;
}

function repository(refresh: CustomerAuthRepository['refresh']): CustomerAuthRepository {
  return {
    startWhatsAppLogin: () => Promise.reject(new Error('unused')),
    resendWhatsAppLogin: () => Promise.reject(new Error('unused')),
    verifyWhatsAppLogin: () => Promise.reject(new Error('unused')),
    startWhatsAppRegistration: () => Promise.reject(new Error('unused')),
    resendWhatsAppRegistration: () => Promise.reject(new Error('unused')),
    verifyWhatsAppRegistration: () => Promise.reject(new Error('unused')),
    refresh,
    logout: () => Promise.resolve(),
  };
}

describe('session gate', () => {
  it('sends a first visit to sign-in because no session is stored', () => {
    expect(sessionGate({
      hasStoredSession: false,
      biometricEnabled: false,
      biometricAvailable: true,
    })).toBe('signed-out');
  });

  it('asks for biometrics when a returning customer enabled them', () => {
    expect(sessionGate({
      hasStoredSession: true,
      biometricEnabled: true,
      biometricAvailable: true,
    })).toBe('biometric');
  });

  it('restores without biometrics when the device has none enrolled', () => {
    expect(sessionGate({
      hasStoredSession: true,
      biometricEnabled: false,
      biometricAvailable: false,
    })).toBe('restore');
  });

  it('does not silently restore after biometric enrollment is removed', () => {
    expect(sessionGate({
      hasStoredSession: true,
      biometricEnabled: true,
      biometricAvailable: false,
    })).toBe('biometric-unavailable');
  });
});

describe('restoreSession', () => {
  it('keeps a fresh access token without calling refresh', async () => {
    const store = memoryStore(session(10 * 60_000, 24 * 60 * 60_000));
    let refreshed = false;
    const restored = await restoreSession(repository(() => {
      refreshed = true;
      return Promise.reject(new Error('unused'));
    }), store, now);
    expect(restored.status).toBe('ready');
    expect(refreshed).toBe(false);
  });

  it('refreshes an expired access token when the refresh token is still valid', async () => {
    const store = memoryStore(session(-1_000, 24 * 60 * 60_000));
    const replacement = session(15 * 60_000, 24 * 60 * 60_000);
    replacement.accessToken = 'next-access';
    const restored = await restoreSession(repository(() => Promise.resolve(replacement)), store, now);
    expect(restored).toEqual({ status: 'ready', session: replacement });
    expect(await store.load()).toEqual(replacement);
  });

  it('does not restore a revoked session through biometric unlock while the access token is still fresh', async () => {
    const store = memoryStore(session(10 * 60_000, 24 * 60 * 60_000));
    const restored = await restoreSession(
      repository(() => Promise.reject({ status: 401 })),
      store,
      now,
      null,
      { requireLiveSession: true },
    );
    expect(restored).toEqual({ status: 'signed-out' });
    expect(await store.load()).toBeNull();
  });

  it('clears a revoked or rejected refresh token', async () => {
    const store = memoryStore(session(-1_000, 24 * 60 * 60_000));
    const restored = await restoreSession(repository(() => Promise.reject({ status: 401 })), store, now);
    expect(restored).toEqual({ status: 'signed-out' });
    expect(await store.load()).toBeNull();
  });

  it('clears a refresh token that has already expired', async () => {
    const store = memoryStore(session(-1_000, -1_000));
    let called = false;
    const restored = await restoreSession(repository(() => {
      called = true;
      return Promise.reject(new Error('offline'));
    }), store, now);
    expect(called).toBe(false);
    expect(restored).toEqual({ status: 'signed-out' });
    expect(await store.load()).toBeNull();
  });

  it('keeps the saved session when refresh fails because the phone is offline', async () => {
    const stored = session(-1_000, 24 * 60 * 60_000);
    const store = memoryStore(stored);
    const restored = await restoreSession(repository(() => Promise.reject(new Error('Network request failed.'))), store, now);
    expect(restored).toEqual({ status: 'offline' });
    expect(await store.load()).toEqual(stored);
  });

  it('keeps a rotated session in memory when secure storage cannot be rewritten', async () => {
    const stored = session(-1_000, 60_000);
    const refreshed = session(60_000, 60_000);
    const store = memoryStore(stored);
    store.save = () => Promise.reject(new Error('User canceled the biometric prompt'));
    const restored = await restoreSession(repository(() => Promise.resolve(refreshed)), store, now);
    expect(restored).toEqual({ status: 'ready', session: refreshed });
  });

  it('uses a session that was already unlocked instead of reading storage again', async () => {
    const stored = session(60_000, 60_000);
    const store = memoryStore(null);
    let reads = 0;
    store.load = () => {
      reads += 1;
      return Promise.resolve(null);
    };
    const restored = await restoreSession(repository(() => Promise.reject(new Error('unused'))), store, now, stored);
    expect(reads).toBe(0);
    expect(restored).toEqual({ status: 'ready', session: stored });
  });

  it('signs out when a protected credential can no longer be read', async () => {
    const store = memoryStore(null);
    const restored = await restoreSession(repository(() => Promise.reject(new Error('unused'))), store, now);
    expect(restored).toEqual({ status: 'signed-out' });
  });
});

describe('logoutCustomer', () => {
  it('revokes one device and clears the local session and biometric preference', async () => {
    const store = memoryStore(session(60_000, 60_000), true);
    let scope = '';
    const auth = repository(() => Promise.reject(new Error('unused')));
    auth.logout = () => {
      scope = 'device';
      return Promise.resolve();
    };
    await logoutCustomer(auth, store, 'access-token');
    expect(scope).toBe('device');
    expect(await store.load()).toBeNull();
    expect(store.biometricEnabled()).toBe(false);
  });

  it('still clears local state when this device cannot reach the server', async () => {
    const store = memoryStore(session(60_000, 60_000), true);
    const auth = repository(() => Promise.reject(new Error('unused')));
    auth.logout = () => Promise.reject(new Error('offline'));
    await expect(logoutCustomer(auth, store, 'access-token')).rejects.toThrow('offline');
    expect(await store.load()).toBeNull();
    expect(store.biometricEnabled()).toBe(false);
  });
});
