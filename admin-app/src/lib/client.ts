import { topUpBody, type TopUpDraft } from './money';

const REFRESH_KEY = 'riders-admin-refresh';
const signedOutListeners = new Set<() => void>();

export function onSignedOut(listener: () => void): () => void {
  signedOutListeners.add(listener);
  return () => signedOutListeners.delete(listener);
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export type SessionTokens = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
};

export type LogoutResult = {
  serverRevoked: boolean;
};

type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: HeadersInit;
  retry?: boolean;
};

export type AdminClient = {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  requestBlob(path: string): Promise<Blob>;
  refresh(): Promise<boolean>;
  adopt(tokens: SessionTokens): void;
  logout(): Promise<LogoutResult>;
  restore(): Promise<boolean>;
  hasRefreshToken(): boolean;
};

export function readRefreshToken(): string | null {
  return sessionStorage.getItem(REFRESH_KEY);
}

export function apiBase(): string {
  return (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
}

export function createAdminClient(fetchImpl: typeof fetch, base = ''): AdminClient & {
  accessToken: () => string | null;
  refreshCalls: () => number;
} {
  let accessToken: string | null = null;
  let refreshing: Promise<boolean> | null = null;
  let refreshCalls = 0;

  function writeSession(tokens: SessionTokens) {
    accessToken = tokens.accessToken;
    sessionStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  }

  function clearSession() {
    accessToken = null;
    sessionStorage.removeItem(REFRESH_KEY);
    signedOutListeners.forEach((listener) => listener());
  }

  async function refresh(): Promise<boolean> {
    if (!refreshing) {
      refreshing = performRefresh().finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  async function performRefresh(): Promise<boolean> {
    const refreshToken = sessionStorage.getItem(REFRESH_KEY);
    if (!refreshToken) {
      clearSession();
      return false;
    }
    refreshCalls += 1;
    try {
      const response = await fetchImpl(`${base}/auth/session/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) {
        clearSession();
        return false;
      }
      const tokens = (await response.json()) as SessionTokens;
      if (!tokens.accessToken || !tokens.refreshToken) {
        clearSession();
        return false;
      }
      writeSession(tokens);
      return true;
    } catch {
      clearSession();
      return false;
    }
  }

  function adopt(tokens: SessionTokens) {
    writeSession(tokens);
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers = new Headers(options.headers);
    if (accessToken) {
      headers.set('Authorization', `Bearer ${accessToken}`);
    }
    if (options.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      throw new ApiError('Network request failed. Check your connection and try again.', 0);
    }
    if (response.status === 401 && !options.retry && !path.startsWith('/auth/admin/')) {
      if (sessionStorage.getItem(REFRESH_KEY)) {
        const refreshed = await refresh();
        if (refreshed) {
          return request<T>(path, { ...options, retry: true });
        }
      } else {
        clearSession();
      }
      throw new ApiError('Your session has ended. Sign in again.', 401);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    const payload = await readBody(response);
    if (!response.ok) {
      throw new ApiError(messageFrom(payload, 'The request could not be completed.'), response.status);
    }
    return payload as T;
  }

  async function requestBlob(path: string, retry = false): Promise<Blob> {
    const headers = new Headers();
    if (accessToken) {
      headers.set('Authorization', `Bearer ${accessToken}`);
    }
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, { headers });
    } catch {
      throw new ApiError('Network request failed. Check your connection and try again.', 0);
    }
    if (response.status === 401 && !retry && sessionStorage.getItem(REFRESH_KEY)) {
      const refreshed = await refresh();
      if (refreshed) {
        return requestBlob(path, true);
      }
      throw new ApiError('Your session has ended. Sign in again.', 401);
    }
    if (!response.ok) {
      const payload = await readBody(response);
      throw new ApiError(messageFrom(payload, 'The licence image could not be loaded.'), response.status);
    }
    return response.blob();
  }

  async function logout(): Promise<LogoutResult> {
    const token = accessToken;
    let serverRevoked = false;
    if (token) {
      try {
        const response = await fetchImpl(`${base}/auth/session/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        serverRevoked = response.status === 204 || response.ok;
      } catch {
        serverRevoked = false;
      }
    }
    clearSession();
    return { serverRevoked };
  }

  return {
    request,
    requestBlob,
    refresh,
    adopt,
    logout,
    restore: refresh,
    hasRefreshToken: () => sessionStorage.getItem(REFRESH_KEY) !== null,
    accessToken: () => accessToken,
    refreshCalls: () => refreshCalls,
  };
}

export const adminApi = createAdminClient(fetch, apiBase());

export function recordTopUp(riderProfileId: string, draft: TopUpDraft) {
  return adminApi.request<TopUpResult>(`/admin/riders/${riderProfileId}/wallet/top-ups`, {
    method: 'POST',
    headers: { 'Idempotency-Key': draft.idempotencyKey },
    body: topUpBody(draft),
  });
}

export type TopUpResult = {
  paymentId: string;
  riderProfileId: string;
  method: string;
  amount: string;
  currency: string;
  internalReceiptId: string | null;
  externalReceiptNumber: string | null;
  ecocashReference: string | null;
  balance: string;
  entryId: string;
  replayed: boolean;
};

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function messageFrom(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }
  const message = (payload as { message?: unknown }).message;
  if (typeof message === 'string' && message.trim()) {
    return message;
  }
  if (Array.isArray(message)) {
    const text = message.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).join(' ');
    if (text) {
      return text;
    }
  }
  return fallback;
}
