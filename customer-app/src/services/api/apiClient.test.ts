import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

import { ApiError, InvalidResponseError, apiGet, apiPost } from './apiClient';
import { installSessionAccess, SessionAccess } from '../session/sessionAccess';
import type { AuthSession } from '../../features/auth/domain/auth.types';

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
  delete process.env.EXPO_PUBLIC_API_BASE_URL;
  installSessionAccess(null);
});

describe('api client errors', () => {
  it('keeps a network failure when fetch rejects', async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.com';
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Network request failed'))));

    await expect(apiGet('/health')).rejects.toThrow(
      'Network request failed. Check your connection and try again.',
    );
  });

  it('reports the HTTP status when the response is not JSON', async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.com';
    const body = '<html>postgresql://app:s3cret@db.example/delivery</html>';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {
      status: 502,
      headers: { 'Content-Type': 'text/html' },
    })));

    const error = await apiGet('/health').then(() => {
      throw new Error('expected the request to fail');
    }, (caught: unknown) => caught);

    expect(error).toBeInstanceOf(InvalidResponseError);
    expect(error).toMatchObject({ message: 'Invalid response from server (502).' });
    expect(String(error)).not.toContain('s3cret');
    expect(String(error)).not.toContain('postgresql://');
    expect(String(error)).not.toContain('<html>');
  });

  it('preserves a JSON API error message and status', async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.com';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      message: 'Authentication failed',
      accessToken: 'secret-access-token',
      statusCode: 401,
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })));

    const error = await apiPost('/auth/customer/login', { phone: '+263771234567' }).then(() => {
      throw new Error('expected the request to fail');
    }, (caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      message: 'Authentication failed',
      status: 401,
    });
    expect(String(error)).not.toContain('secret-access-token');
  });

  it('hides a missing-route message and its query string', async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.com';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      message: 'Cannot GET /auth/places?text=mutamba&sessionToken=11111111-2222-4333-8444-555555555555',
      error: 'Not Found',
      statusCode: 404,
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })));

    const error = await apiGet('/auth/places').then(() => {
      throw new Error('expected the request to fail');
    }, (caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      message: 'This service is not available right now.',
      status: 404,
    });
    expect(String(error)).not.toContain('sessionToken');
    expect(String(error)).not.toContain('11111111');
  });

  it('reports a timeout when the request is aborted', async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.com';
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        reject(error);
      });
    })));

    const pending = apiGet('/health');
    const failure = pending.then(() => {
      throw new Error('expected the request to time out');
    }, (caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(failure).resolves.toMatchObject({
      message: 'The request timed out. Check your connection and try again.',
    });
  });
});

describe('authorized requests', () => {
  const now = Date.parse('2026-10-27T16:00:00.000Z');

  function tokens(accessToken: string, refreshToken: string, accessInMs: number): AuthSession {
    return {
      accessToken,
      refreshToken,
      accessTokenExpiresAt: new Date(now + accessInMs).toISOString(),
      refreshTokenExpiresAt: new Date(now + 86_400_000).toISOString(),
    };
  }

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  it('sends an expired-token request once with the refreshed access token', async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.com';
    const rotated = tokens('access-new', 'refresh-new', 900_000);
    const access = new SessionAccess({
      now: () => now,
      refresh: async () => rotated,
    });
    access.replace(tokens('access-old', 'refresh-old', -1_000));
    installSessionAccess(access);
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => jsonResponse(200, { ok: true }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiGet('/customers/me/deliveries', { accessToken: 'access-old' })).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: 'Bearer access-new' },
    });
  });

  it('retries one eligible request after a rejected access token is refreshed', async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.com';
    const rotated = tokens('access-new', 'refresh-new', 900_000);
    let refreshes = 0;
    const access = new SessionAccess({
      now: () => now,
      refresh: async () => {
        refreshes += 1;
        return rotated;
      },
    });
    access.replace(tokens('access-old', 'refresh-old', 900_000));
    installSessionAccess(access);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Authentication failed' }))
      .mockResolvedValueOnce(jsonResponse(200, { offers: 1 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiGet('/customers/me/deliveries/delivery-1/bids', { accessToken: 'access-old' })).resolves.toEqual({ offers: 1 });
    expect(refreshes).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares one refresh when concurrent requests are rejected', async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.com';
    const rotated = tokens('access-new', 'refresh-new', 900_000);
    let refreshes = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const access = new SessionAccess({
      now: () => now,
      refresh: async () => {
        refreshes += 1;
        await gate;
        return rotated;
      },
    });
    access.replace(tokens('access-old', 'refresh-old', 900_000));
    installSessionAccess(access);
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (headers.get('Authorization') === 'Bearer access-old') {
        return jsonResponse(401, { message: 'Authentication failed' });
      }
      return jsonResponse(200, { ok: true });
    }));

    const pending = Promise.all([
      apiGet('/customers/me/deliveries', { accessToken: 'access-old' }),
      apiGet('/customers/me/deliveries/delivery-1/bids', { accessToken: 'access-old' }),
    ]);
    release();
    await expect(pending).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(refreshes).toBe(1);
  });

  it('does not send a delivery creation twice after refreshing', async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.com';
    const access = new SessionAccess({
      now: () => now,
      refresh: async () => tokens('access-new', 'refresh-new', 900_000),
    });
    access.replace(tokens('access-old', 'refresh-old', 900_000));
    installSessionAccess(access);
    const fetchMock = vi.fn(async () => jsonResponse(401, { message: 'Authentication failed' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiPost('/customers/me/deliveries', { parcel: true }, { accessToken: 'access-old' })).rejects.toMatchObject({
      message: 'Authentication failed',
      status: 401,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(access.current()?.accessToken).toBe('access-new');
  });

  it('keeps an authentication failure distinct from a lost refresh response', async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.com';
    const rejected = new SessionAccess({
      now: () => now,
      refresh: async () => {
        throw new ApiError('Authentication failed', 401);
      },
    });
    rejected.replace(tokens('access-old', 'refresh-old', -1_000));
    installSessionAccess(rejected);
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { ok: true })));

    await expect(apiGet('/customers/me/deliveries', { accessToken: 'access-old' })).rejects.toMatchObject({
      name: 'ApiError',
      message: 'Authentication failed',
      status: 401,
    });

    const lost = new SessionAccess({
      now: () => now,
      refresh: async () => {
        throw new Error('Network request failed. Check your connection and try again.');
      },
    });
    lost.replace(tokens('access-old', 'refresh-old', -1_000));
    installSessionAccess(lost);

    await expect(apiGet('/customers/me/deliveries', { accessToken: 'access-old' })).rejects.toThrow(
      'Network request failed. Check your connection and try again.',
    );
    await expect(apiGet('/customers/me/deliveries', { accessToken: 'access-old' })).rejects.not.toBeInstanceOf(ApiError);
  });
});
