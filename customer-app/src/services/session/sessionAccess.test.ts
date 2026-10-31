import { describe, expect, it, vi } from 'vitest';

import type { AuthSession } from '../../features/auth/domain/auth.types';
import {
  SessionAccess,
  accessNeedsRefresh,
  isUnreachableRefresh,
  requestCanReplayAfterRefresh,
} from './sessionAccess';

const NOW = Date.parse('2026-10-27T16:00:00.000Z');

function session(accessToken: string, refreshToken: string, accessInMs: number): AuthSession {
  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: new Date(NOW + accessInMs).toISOString(),
    refreshTokenExpiresAt: new Date(NOW + 86_400_000).toISOString(),
  };
}

describe('session access', () => {
  it('refreshes an expired access token once for concurrent callers', async () => {
    const current = session('access-old', 'refresh-old', -1_000);
    const rotated = session('access-new', 'refresh-new', 900_000);
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const notices: string[] = [];
    const access = new SessionAccess({
      now: () => NOW,
      refresh: async (refreshToken) => {
        calls += 1;
        expect(refreshToken).toBe('refresh-old');
        await gate;
        return rotated;
      },
    });
    access.replace(current);
    access.subscribe((notice) => notices.push(notice.type));

    const pending = Promise.all([
      access.tokenFor('access-old'),
      access.tokenFor('access-old'),
      access.recover('access-old'),
    ]);
    release();

    await expect(pending).resolves.toEqual([
      { ok: true, token: 'access-new' },
      { ok: true, token: 'access-new' },
      { ok: true, token: 'access-new' },
    ]);
    expect(calls).toBe(1);
    expect(notices).toEqual(['refreshed']);
    expect(access.current()).toEqual(rotated);
  });

  it('keeps a valid access token without refreshing', async () => {
    const current = session('access-current', 'refresh-current', 900_000);
    const access = new SessionAccess({
      now: () => NOW,
      refresh: () => Promise.reject(new Error('unused')),
    });
    access.replace(current);
    expect(accessNeedsRefresh(current, NOW)).toBe(false);
    await expect(access.tokenFor('access-current')).resolves.toEqual({ ok: true, token: 'access-current' });
  });

  it('clears the session when refresh is rejected', async () => {
    const current = session('access-old', 'refresh-old', -1_000);
    let cleared = false;
    const notices: string[] = [];
    const access = new SessionAccess({
      now: () => NOW,
      refresh: () => Promise.reject(Object.assign(new Error('Authentication failed'), { status: 401 })),
      clear: async () => {
        cleared = true;
      },
    });
    access.replace(current);
    access.subscribe((notice) => notices.push(notice.type));

    await expect(access.tokenFor('access-old')).resolves.toEqual({ ok: false, reason: 'revoked' });
    expect(cleared).toBe(true);
    expect(access.current()).toBeNull();
    expect(notices).toEqual(['revoked']);
  });

  it('does not send a refresh token again after the response is lost', async () => {
    const current = session('access-old', 'refresh-old', -1_000);
    let calls = 0;
    const access = new SessionAccess({
      now: () => NOW,
      refresh: () => {
        calls += 1;
        return Promise.reject(new Error('Network request failed. Check your connection and try again.'));
      },
    });
    access.replace(current);

    await expect(access.tokenFor('access-old')).resolves.toEqual({ ok: false, reason: 'unreachable' });
    await expect(access.recover('access-old')).resolves.toEqual({ ok: false, reason: 'unreachable' });
    expect(calls).toBe(1);
    expect(access.current()).toEqual(current);
    expect(isUnreachableRefresh(new Error('Network request failed. Check your connection and try again.'))).toBe(true);
  });

  it('allows a later refresh after a completed server error', async () => {
    const current = session('access-old', 'refresh-old', -1_000);
    const rotated = session('access-new', 'refresh-new', 900_000);
    const refresh = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('Request failed (503).'), { status: 503 }))
      .mockResolvedValueOnce(rotated);
    const access = new SessionAccess({ now: () => NOW, refresh });
    access.replace(current);

    await expect(access.tokenFor('access-old')).resolves.toEqual({ ok: false, reason: 'unavailable' });
    await expect(access.tokenFor('access-old')).resolves.toEqual({ ok: true, token: 'access-new' });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does not apply a refresh that finished after sign-out', async () => {
    const current = session('access-old', 'refresh-old', -1_000);
    let release: (session: AuthSession) => void = () => {};
    const access = new SessionAccess({
      now: () => NOW,
      refresh: () => new Promise((resolve) => {
        release = resolve;
      }),
    });
    access.replace(current);
    const pending = access.tokenFor('access-old');
    access.replace(null);
    release(session('access-late', 'refresh-late', 900_000));
    await expect(pending).resolves.toEqual({ ok: false, reason: 'revoked' });
    expect(access.current()).toBeNull();
  });

  it('replays only reads, quotes, and idempotent writes', () => {
    expect(requestCanReplayAfterRefresh('GET', '/customers/me/deliveries')).toBe(true);
    expect(requestCanReplayAfterRefresh('POST', '/customers/me/deliveries/quote')).toBe(true);
    expect(requestCanReplayAfterRefresh('POST', '/customers/me/deliveries/delivery-1/bids/bid-1/acceptance', {
      'Idempotency-Key': 'key-1',
    })).toBe(true);
    expect(requestCanReplayAfterRefresh('POST', '/customers/me/deliveries')).toBe(false);
    expect(requestCanReplayAfterRefresh('POST', '/customers/me/deliveries/delivery-1/cancellation')).toBe(false);
  });
});
