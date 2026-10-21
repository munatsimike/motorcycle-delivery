import { afterEach, describe, expect, it } from 'vitest';
import { createAdminClient } from './client';
import { topUpBody } from './money';

const tokens = {
  accessToken: 'access-2',
  refreshToken: 'refresh-2',
  accessTokenExpiresAt: 'soon',
  refreshTokenExpiresAt: 'later',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  sessionStorage.clear();
});

describe('admin session client', () => {
  it('reuses one idempotency key when the same top-up is sent again', async () => {
    const keys: string[] = [];
    const draft = {
      idempotencyKey: 'same-key',
      amount: '2.00',
      method: 'CASH' as const,
      externalReceiptNumber: null,
      ecocashReference: null,
    };
    const client = createAdminClient(async (_input, init) => {
      keys.push(new Headers(init?.headers).get('Idempotency-Key') ?? '');
      if (keys.length === 1) {
        return json({ message: 'The server could not record the payment.' }, 502);
      }
      return json({ paymentId: 'payment-1', replayed: false });
    }, 'http://api.test');
    const options = { method: 'POST', headers: { 'Idempotency-Key': draft.idempotencyKey }, body: topUpBody(draft) };
    await expect(client.request('/admin/riders/rider-1/wallet/top-ups', options)).rejects.toThrow('The server could not record the payment.');
    await client.request('/admin/riders/rider-1/wallet/top-ups', options);
    expect(keys).toEqual(['same-key', 'same-key']);
    expect(topUpBody(draft).paymentReceived).toBe(true);
  });

  it('shares one refresh across simultaneous expired requests', async () => {
    sessionStorage.setItem('riders-admin-refresh', 'refresh-1');
    let refreshes = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/auth/session/refresh')) {
        refreshes += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return json(tokens);
      }
      const header = new Headers(init?.headers).get('Authorization');
      if (header !== 'Bearer access-2') {
        return json({ message: 'Authentication failed' }, 401);
      }
      return json({ ok: true });
    };
    const client = createAdminClient(fetchImpl, 'http://api.test');
    const [first, second] = await Promise.all([
      client.request<{ ok: boolean }>('/admin/dashboard/summary'),
      client.request<{ ok: boolean }>('/admin/riders'),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(refreshes).toBe(1);
    expect(client.refreshCalls()).toBe(1);
    expect(sessionStorage.getItem('riders-admin-refresh')).toBe('refresh-2');
    expect(sessionStorage.getItem('riders-admin-access')).toBeNull();
  });

  it('clears the session when refresh fails and does not retry again', async () => {
    sessionStorage.setItem('riders-admin-refresh', 'refresh-1');
    let refreshes = 0;
    const fetchImpl: typeof fetch = async (input) => {
      if (String(input).endsWith('/auth/session/refresh')) {
        refreshes += 1;
        return json({ message: 'Authentication failed' }, 401);
      }
      return json({ message: 'Authentication failed' }, 401);
    };
    const client = createAdminClient(fetchImpl, 'http://api.test');
    await expect(client.request('/admin/dashboard/summary')).rejects.toThrow('Your session has ended. Sign in again.');
    expect(refreshes).toBe(1);
    expect(sessionStorage.getItem('riders-admin-refresh')).toBeNull();
    expect(client.accessToken()).toBeNull();
  });

  it('clears this browser when logout cannot reach the server', async () => {
    sessionStorage.setItem('riders-admin-refresh', 'refresh-1');
    const client = createAdminClient(async (input) => {
      if (String(input).endsWith('/auth/session/refresh')) {
        return json(tokens);
      }
      throw new Error('offline');
    }, 'http://api.test');
    expect(await client.restore()).toBe(true);
    const result = await client.logout();
    expect(result.serverRevoked).toBe(false);
    expect(sessionStorage.getItem('riders-admin-refresh')).toBeNull();
    expect(client.accessToken()).toBeNull();
  });
});
