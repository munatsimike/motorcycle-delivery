import { describe, expect, it } from 'vitest';

import type { AuthSession } from '../auth.types';
import { SessionAccess } from '../../../../services/session/sessionAccess';
import type { PushRegistrationStore } from '../../../notifications/domain/customerPushRegistration';
import { WELCOME_LOGOUT_NOTICE, signOutCustomer } from './signOutCustomer';

const NOW = Date.parse('2026-11-03T19:00:00.000Z');

function session(accessToken: string, refreshToken: string, accessInMs: number): AuthSession {
  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: new Date(NOW + accessInMs).toISOString(),
    refreshTokenExpiresAt: new Date(NOW + 86_400_000).toISOString(),
  };
}

function memoryPush(initial: { customerId: string; token: string } | null = null): PushRegistrationStore & {
  current(): typeof initial;
} {
  let saved = initial;
  return {
    current: () => saved,
    async load() {
      return saved;
    },
    async save(registration) {
      saved = registration;
    },
    async clear() {
      saved = null;
    },
  };
}

describe('signOutCustomer', () => {
  it('unregisters with a valid access token before clearing the session', async () => {
    const pushStore = memoryPush({ customerId: 'customer-a', token: 'fcm-1' });
    const order: string[] = [];
    const result = await signOutCustomer({
      accessToken: 'access-current',
      pushStore,
      removePush: async (accessToken, token) => {
        order.push(`remove:${accessToken}:${token}`);
      },
      currentAccessToken: () => 'access-current',
      clearLiveSession: () => {
        order.push('clear-session');
      },
      logout: async (token) => {
        order.push(`logout:${token}`);
      },
    });
    expect(order).toEqual([
      'remove:access-current:fcm-1',
      'clear-session',
      'logout:access-current',
    ]);
    expect(result).toEqual({ signedOut: true, welcomeNotice: null, push: 'removed' });
    expect(WELCOME_LOGOUT_NOTICE).toBeNull();
    expect(pushStore.current()).toBeNull();
  });

  it('refreshes an expired access token before unregister and uses the rotated token for logout', async () => {
    const current = session('access-old', 'refresh-old', -1_000);
    const rotated = session('access-new', 'refresh-new', 900_000);
    const access = new SessionAccess({
      now: () => NOW,
      refresh: async (refreshToken) => {
        expect(refreshToken).toBe('refresh-old');
        return rotated;
      },
    });
    access.replace(current);
    const pushStore = memoryPush({ customerId: 'customer-a', token: 'fcm-1' });
    const removedWith: string[] = [];
    const result = await signOutCustomer({
      accessToken: current.accessToken,
      pushStore,
      removePush: async (presented, token) => {
        expect(access.current()).not.toBeNull();
        const decision = await access.tokenFor(presented);
        if (!decision.ok) {
          throw Object.assign(new Error('Authentication failed'), { status: 401 });
        }
        removedWith.push(`${decision.token}:${token}`);
      },
      currentAccessToken: () => access.current()?.accessToken ?? null,
      clearLiveSession: () => access.replace(null),
      logout: async (token) => {
        expect(token).toBe('access-new');
      },
    });
    expect(removedWith).toEqual(['access-new:fcm-1']);
    expect(result.push).toBe('removed');
    expect(result.welcomeNotice).toBeNull();
    expect(access.current()).toBeNull();
    expect(pushStore.current()).toBeNull();
  });

  it('still signs out when the refresh token is revoked', async () => {
    const current = session('access-old', 'refresh-old', -1_000);
    const access = new SessionAccess({
      now: () => NOW,
      refresh: () => Promise.reject(Object.assign(new Error('Authentication failed'), { status: 401 })),
    });
    access.replace(current);
    const pushStore = memoryPush({ customerId: 'customer-a', token: 'fcm-1' });
    let loggedOutWith: string | null = 'unset';
    const result = await signOutCustomer({
      accessToken: current.accessToken,
      pushStore,
      removePush: async (presented) => {
        const decision = await access.tokenFor(presented);
        if (!decision.ok) {
          throw Object.assign(new Error('Authentication failed'), { status: 401 });
        }
      },
      currentAccessToken: () => access.current()?.accessToken ?? null,
      clearLiveSession: () => access.replace(null),
      logout: async (token) => {
        loggedOutWith = token;
      },
    });
    expect(result.signedOut).toBe(true);
    expect(result.push).toBe('unauthorized');
    expect(result.welcomeNotice).toBeNull();
    expect(pushStore.current()).toBeNull();
    expect(access.current()).toBeNull();
    expect(loggedOutWith).toBe('access-old');
  });

  it('clears local push state on unregister 401 or 403 without claiming deletion succeeded', async () => {
    for (const status of [401, 403]) {
      const pushStore = memoryPush({ customerId: 'customer-a', token: 'fcm-1' });
      const result = await signOutCustomer({
        accessToken: 'access-current',
        pushStore,
        removePush: async () => {
          throw Object.assign(new Error('Authentication failed'), { status });
        },
        currentAccessToken: () => 'access-current',
        clearLiveSession: () => undefined,
        logout: async () => undefined,
      });
      expect(result.push).toBe('unauthorized');
      expect(result.push).not.toBe('removed');
      expect(result.welcomeNotice).toBeNull();
      expect(pushStore.current()).toBeNull();
    }
  });

  it('completes logout on network failure and keeps only the local FCM token', async () => {
    const pushStore = memoryPush({ customerId: 'customer-a', token: 'fcm-1' });
    let sessionPresent = true;
    const result = await signOutCustomer({
      accessToken: 'access-current',
      pushStore,
      removePush: async () => {
        throw new Error('Network request failed. Check your connection and try again.');
      },
      currentAccessToken: () => (sessionPresent ? 'access-current' : null),
      clearLiveSession: () => {
        sessionPresent = false;
      },
      logout: async () => {
        throw new Error('offline');
      },
    });
    expect(result.signedOut).toBe(true);
    expect(result.push).toBe('failed');
    expect(result.welcomeNotice).toBeNull();
    expect(pushStore.current()).toEqual({ customerId: 'customer-a', token: 'fcm-1' });
    expect(sessionPresent).toBe(false);
  });

  it('completes logout on a backend 5xx without retaining credentials', async () => {
    const pushStore = memoryPush({ customerId: 'customer-a', token: 'fcm-1' });
    let liveToken: string | null = 'access-current';
    const result = await signOutCustomer({
      accessToken: 'access-current',
      pushStore,
      removePush: async () => {
        throw Object.assign(new Error('Request failed (500).'), { status: 500 });
      },
      currentAccessToken: () => liveToken,
      clearLiveSession: () => {
        liveToken = null;
      },
      logout: async (token) => {
        expect(token).toBe('access-current');
      },
    });
    expect(result.signedOut).toBe(true);
    expect(result.push).toBe('failed');
    expect(result.welcomeNotice).toBeNull();
    expect(pushStore.current()).toEqual({ customerId: 'customer-a', token: 'fcm-1' });
    expect(liveToken).toBeNull();
  });

  it('skips unregister when no FCM token is stored', async () => {
    const pushStore = memoryPush(null);
    let removed = false;
    const result = await signOutCustomer({
      accessToken: 'access-current',
      pushStore,
      removePush: async () => {
        removed = true;
      },
      currentAccessToken: () => 'access-current',
      clearLiveSession: () => undefined,
      logout: async (token) => {
        expect(token).toBe('access-current');
      },
    });
    expect(removed).toBe(false);
    expect(result.push).toBe('skipped');
    expect(result.signedOut).toBe(true);
    expect(result.welcomeNotice).toBeNull();
  });

  it('is safe to call repeatedly after the first sign-out', async () => {
    const pushStore = memoryPush({ customerId: 'customer-a', token: 'fcm-1' });
    let liveToken: string | null = 'access-current';
    const first = await signOutCustomer({
      accessToken: liveToken,
      pushStore,
      removePush: async () => undefined,
      currentAccessToken: () => liveToken,
      clearLiveSession: () => {
        liveToken = null;
      },
      logout: async () => undefined,
    });
    expect(first.push).toBe('removed');
    const second = await signOutCustomer({
      accessToken: liveToken,
      pushStore,
      removePush: async () => {
        throw new Error('should not unregister again');
      },
      currentAccessToken: () => liveToken,
      clearLiveSession: () => {
        liveToken = null;
      },
      logout: async (token) => {
        expect(token).toBeNull();
      },
    });
    expect(second.signedOut).toBe(true);
    expect(second.push).toBe('skipped');
    expect(second.welcomeNotice).toBeNull();
  });

  it('never returns a technical error for the public Welcome screen', async () => {
    const failures = [
      async () => {
        throw new Error('Network request failed. Check your connection and try again.');
      },
      async () => {
        throw Object.assign(new Error('Authentication failed'), { status: 401 });
      },
      async () => {
        throw Object.assign(new Error('Request failed (503).'), { status: 503 });
      },
    ];
    for (const removePush of failures) {
      const result = await signOutCustomer({
        accessToken: 'access-current',
        pushStore: memoryPush({ customerId: 'customer-a', token: 'fcm-1' }),
        removePush,
        currentAccessToken: () => 'access-current',
        clearLiveSession: () => undefined,
        logout: async () => undefined,
      });
      expect(result.welcomeNotice).toBeNull();
      expect(WELCOME_LOGOUT_NOTICE).toBeNull();
    }
  });
});
