import { describe, expect, it } from 'vitest';

import { ApiError } from './apiError';
import type { AuthSession } from './auth.types';
import type { RiderAuthRepository } from './repositories/RiderAuthRepository';
import type { RiderSessionStore } from './repositories/RiderSessionStore';
import { RiderSessionGate, unauthorized } from './sessionGate';

const NOW = Date.parse('2026-10-16T15:00:00.000Z');

function session(suffix: string, accessExpiresAt: string): AuthSession {
  return {
    accessToken: `access-${suffix}`,
    refreshToken: `refresh-token-${suffix}`,
    accessTokenExpiresAt: accessExpiresAt,
    refreshTokenExpiresAt: '2026-11-16T15:00:00.000Z',
  };
}

describe('rider session gate', () => {
  it('restores a usable access token without refreshing', async () => {
    const stored = session('1', '2026-10-16T15:10:00.000Z');
    const store = memoryStore(stored);
    let refreshed = 0;
    const gate = new RiderSessionGate(repository({
      refresh: async () => {
        refreshed += 1;
        return session('2', '2026-10-16T15:20:00.000Z');
      },
    }), store);

    await expect(gate.restore(NOW)).resolves.toEqual(stored);
    expect(refreshed).toBe(0);
  });

  it('rotates an expired access token and stores the new session', async () => {
    const stored = session('1', '2026-10-16T15:00:00.000Z');
    const rotated = session('2', '2026-10-16T15:15:00.000Z');
    const store = memoryStore(stored);
    const seen: string[] = [];
    const gate = new RiderSessionGate(repository({
      refresh: async (token) => {
        seen.push(token);
        return rotated;
      },
    }), store);

    await expect(gate.restore(NOW)).resolves.toEqual(rotated);
    expect(seen).toEqual(['refresh-token-1']);
    await expect(store.load()).resolves.toEqual(rotated);
  });

  it('shares one refresh across overlapping callers', async () => {
    const stored = session('1', '2026-10-16T15:00:00.000Z');
    const rotated = session('2', '2026-10-16T15:15:00.000Z');
    const store = memoryStore(stored);
    let started = 0;
    let release: (value: AuthSession) => void = () => undefined;
    const pending = new Promise<AuthSession>((resolve) => {
      release = resolve;
    });
    const gate = new RiderSessionGate(repository({
      refresh: (token) => {
        started += 1;
        expect(token).toBe('refresh-token-1');
        return pending;
      },
    }), store);

    const first = gate.refreshStored();
    const second = gate.refreshStored();
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toBe(1);
    release(rotated);

    await expect(Promise.all([first, second])).resolves.toEqual([rotated, rotated]);
    await expect(store.load()).resolves.toEqual(rotated);

    const seen: string[] = [];
    const follow = new RiderSessionGate(repository({
      refresh: async (token) => {
        seen.push(token);
        return session('3', '2026-10-16T15:30:00.000Z');
      },
    }), store);
    await follow.refreshStored();
    expect(seen).toEqual(['refresh-token-2']);
  });

  it('clears stored credentials when refresh is unauthorized', async () => {
    const store = memoryStore(session('1', '2026-10-16T15:00:00.000Z'));
    const gate = new RiderSessionGate(repository({
      refresh: async () => {
        throw unauthorized();
      },
    }), store);

    await expect(gate.restore(NOW)).resolves.toBeNull();
    await expect(store.load()).resolves.toBeNull();
  });

  it('refreshes once after an unauthorized request and retries', async () => {
    const stored = session('1', '2026-10-16T15:10:00.000Z');
    const rotated = session('2', '2026-10-16T15:25:00.000Z');
    const store = memoryStore(stored);
    let refreshes = 0;
    const tokens: string[] = [];
    const gate = new RiderSessionGate(repository({
      refresh: async () => {
        refreshes += 1;
        await store.save(rotated);
        return rotated;
      },
    }), store);

    const load = (accessToken: string) => {
      tokens.push(accessToken);
      if (accessToken === 'access-1') {
        return Promise.reject(new ApiError('Authentication failed', 401));
      }
      return Promise.resolve('onboarding');
    };

    await expect(Promise.all([
      gate.authorized(load, NOW),
      gate.authorized(load, NOW),
    ])).resolves.toEqual(['onboarding', 'onboarding']);
    expect(refreshes).toBe(1);
    expect(tokens.filter((token) => token === 'access-2').length).toBe(2);
  });

  it('signs out the current session and every session', async () => {
    const store = memoryStore(session('1', '2026-10-16T15:10:00.000Z'));
    const calls: string[] = [];
    const gate = new RiderSessionGate(repository({
      logout: async (accessToken) => {
        calls.push(`current:${accessToken}`);
      },
      logoutAll: async (accessToken) => {
        calls.push(`all:${accessToken}`);
      },
    }), store);

    await gate.logout('current');
    expect(calls).toEqual(['current:access-1']);
    await expect(store.load()).resolves.toBeNull();

    await store.save(session('1', '2026-10-16T15:10:00.000Z'));
    await gate.logout('all');
    expect(calls).toEqual(['current:access-1', 'all:access-1']);
    await expect(store.load()).resolves.toBeNull();
  });

  it('clears credentials when logout is rejected', async () => {
    const store = memoryStore(session('1', '2026-10-16T15:10:00.000Z'));
    const gate = new RiderSessionGate(repository({
      logout: async () => {
        throw unauthorized();
      },
    }), store);

    await expect(gate.logout('current')).rejects.toBeInstanceOf(ApiError);
    await expect(store.load()).resolves.toBeNull();
  });
});

function memoryStore(initial: AuthSession | null): RiderSessionStore {
  let current = initial;
  return {
    async load() {
      return current;
    },
    async save(session) {
      current = session;
    },
    async clear() {
      current = null;
    },
  };
}

function repository(overrides: Partial<RiderAuthRepository>): RiderAuthRepository {
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
