import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

import { ApiError, InvalidResponseError, apiGet, apiPost } from './apiClient';

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
  delete process.env.EXPO_PUBLIC_API_BASE_URL;
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
