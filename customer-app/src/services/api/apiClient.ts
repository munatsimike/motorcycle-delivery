import { Platform } from 'react-native';

import {
  installedSessionAccess,
  requestCanReplayAfterRefresh,
  type AccessFailure,
} from '../session/sessionAccess';
import { looksLikeAndroidEmulator, resolveApiBaseUrl } from './apiBaseUrl';

const REQUEST_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class InvalidResponseError extends Error {
  constructor(status: number) {
    super(`Invalid response from server (${status}).`);
    this.name = 'InvalidResponseError';
  }
}

type RequestOptions = {
  accessToken?: string;
  headers?: Record<string, string>;
};

export function apiGet<TResponse>(path: string, options?: RequestOptions): Promise<TResponse> {
  return apiRequest<TResponse>(path, { method: 'GET' }, options);
}

export function apiPost<TResponse>(
  path: string,
  body: unknown,
  options?: RequestOptions,
): Promise<TResponse> {
  return apiRequest<TResponse>(path, {
    method: 'POST',
    body: JSON.stringify(body),
  }, options);
}

export function apiPatch<TResponse>(
  path: string,
  body: unknown,
  options?: RequestOptions,
): Promise<TResponse> {
  return apiRequest<TResponse>(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }, options);
}

export async function apiGetBytes(path: string, options?: RequestOptions): Promise<Uint8Array | null> {
  const session = installedSessionAccess();
  let token = options?.accessToken;
  let replayed = false;

  for (;;) {
    if (token && session) {
      const decision = replayed ? await session.recover(token) : await session.tokenFor(token);
      if (!decision.ok) {
        return null;
      }
      token = decision.token;
    }

    const outcome = await readBytes(path, options, token);
    if (outcome === 'unauthorized' && token && session && !replayed) {
      replayed = true;
      continue;
    }
    return outcome === 'unauthorized' ? null : outcome;
  }
}

async function readBytes(
  path: string,
  options: RequestOptions | undefined,
  token: string | undefined,
): Promise<Uint8Array | null | 'unauthorized'> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Accept: options?.headers?.Accept ?? 'image/png',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(`${apiBaseUrl()}${path}`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    if (response.status === 401) {
      return 'unauthorized';
    }
    if (!response.ok) {
      return null;
    }
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function apiPut<TResponse>(
  path: string,
  body: unknown,
  options?: RequestOptions,
): Promise<TResponse> {
  return apiRequest<TResponse>(path, {
    method: 'PUT',
    body: JSON.stringify(body),
  }, options);
}

export type UploadFile = {
  uri: string;
  name: string;
  type: string;
};

export function apiUpload(
  path: string,
  file: UploadFile,
  options?: RequestOptions & { onProgress?: (percent: number) => void },
): Promise<unknown> {
  const session = installedSessionAccess();
  let token = options?.accessToken;
  let replayed = false;

  const sendOnce = async (): Promise<unknown> => {
    if (token && session) {
      const decision = replayed ? await session.recover(token) : await session.tokenFor(token);
      if (!decision.ok) {
        throw failureFor(decision.reason);
      }
      token = decision.token;
    }
    return uploadRequest(path, file, options, token);
  };

  return sendOnce().catch(async (error: unknown) => {
    const canRecover = error instanceof ApiError && error.status === 401 && Boolean(token) && session !== null && !replayed;
    if (!canRecover || !token || !session) {
      throw error;
    }
    replayed = true;
    const decision = await session.recover(token);
    if (!decision.ok) {
      throw decision.reason === 'revoked' ? error : failureFor(decision.reason);
    }
    token = decision.token;
    return uploadRequest(path, file, options, token);
  });
}

function uploadRequest(
  path: string,
  file: UploadFile,
  options: (RequestOptions & { onProgress?: (percent: number) => void }) | undefined,
  token: string | undefined,
): Promise<unknown> {
  const body = new FormData();
  body.append('image', {
    uri: file.uri,
    name: file.name,
    type: file.type,
  } as unknown as Blob);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const timer = setTimeout(() => {
      xhr.abort();
      reject(new Error('The request timed out. Check your connection and try again.'));
    }, 60_000);
    xhr.open('POST', `${apiBaseUrl()}${path}`);
    xhr.setRequestHeader('Accept', 'application/json');
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        options?.onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    };
    xhr.onload = () => {
      clearTimeout(timer);
      const data = parseUploadBody(xhr.responseText);
      if (xhr.status === 401) {
        reject(new ApiError(messageFrom(data, xhr.status), 401));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new ApiError(messageFrom(data, xhr.status), xhr.status));
        return;
      }
      resolve(data);
    };
    xhr.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Network request failed. Check your connection and try again.'));
    };
    xhr.onabort = () => {
      clearTimeout(timer);
      reject(new Error('The request timed out. Check your connection and try again.'));
    };
    xhr.send(body);
  });
}

function parseUploadBody(text: string): unknown {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function apiDelete<TResponse>(
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<TResponse> {
  return apiRequest<TResponse>(path, {
    method: 'DELETE',
    body: body === undefined ? undefined : JSON.stringify(body),
  }, options);
}

async function apiRequest<TResponse>(
  path: string,
  init: { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: string },
  options?: RequestOptions,
): Promise<TResponse> {
  const session = path.startsWith('/auth/') ? null : installedSessionAccess();
  let token = options?.accessToken;
  let replayed = false;

  for (;;) {
    if (token && session) {
      const decision = await session.tokenFor(token);
      if (!decision.ok) {
        throw failureFor(decision.reason);
      }
      token = decision.token;
    }

    try {
      return await send<TResponse>(path, init, options, token);
    } catch (error) {
      const canRecover = error instanceof ApiError
        && error.status === 401
        && Boolean(token)
        && session !== null
        && !replayed;
      if (!canRecover || !token || !session) {
        throw error;
      }
      replayed = true;
      const decision = await session.recover(token);
      if (!decision.ok) {
        throw decision.reason === 'revoked' ? error : failureFor(decision.reason);
      }
      if (!requestCanReplayAfterRefresh(init.method, path, options?.headers)) {
        throw error;
      }
      token = decision.token;
    }
  }
}

async function send<TResponse>(
  path: string,
  init: { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: string },
  options: RequestOptions | undefined,
  token: string | undefined,
): Promise<TResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (init.body) {
      headers['Content-Type'] = 'application/json';
    }
    if (options?.headers) {
      Object.assign(headers, options.headers);
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${apiBaseUrl()}${path}`, {
      method: init.method,
      headers,
      body: init.body,
      signal: controller.signal,
    });
    const data = await readBody(response);
    if (!response.ok) {
      throw new ApiError(messageFrom(data, response.status), response.status);
    }
    return data as TResponse;
  } catch (error) {
    if (error instanceof ApiError || error instanceof InvalidResponseError) {
      throw error;
    }
    if (isAbortError(error)) {
      throw new Error('The request timed out. Check your connection and try again.');
    }
    throw new Error('Network request failed. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
}

function failureFor(reason: AccessFailure): Error {
  if (reason === 'revoked') {
    return new ApiError('Authentication failed', 401);
  }
  return new Error('Network request failed. Check your connection and try again.');
}

function apiBaseUrl(): string {
  return resolveApiBaseUrl({
    configured: process.env.EXPO_PUBLIC_API_BASE_URL,
    dev: typeof __DEV__ === 'boolean' ? __DEV__ : false,
    platform: Platform.OS,
    emulator: isAndroidEmulator(),
  });
}

function isAndroidEmulator(): boolean {
  if (Platform.OS !== 'android') {
    return false;
  }
  const constants = Platform.constants as {
    Fingerprint?: string;
    Model?: string;
    Hardware?: string;
    Product?: string;
    Manufacturer?: string;
  };
  return looksLikeAndroidEmulator({
    fingerprint: constants.Fingerprint,
    model: constants.Model,
    hardware: constants.Hardware,
    product: constants.Product,
    manufacturer: constants.Manufacturer,
  });
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new InvalidResponseError(response.status);
  }
}

const ROUTE_MISS = /^Cannot (GET|POST|PUT|PATCH|DELETE) \//;

export const SERVICE_UNAVAILABLE_MESSAGE = 'This service is not available right now.';

function messageFrom(data: unknown, status: number): string {
  const message = rawMessage(data);
  if (message && !ROUTE_MISS.test(message)) {
    return message;
  }
  if (message) {
    return SERVICE_UNAVAILABLE_MESSAGE;
  }
  return `Request failed (${status}).`;
}

function rawMessage(data: unknown): string | null {
  if (data && typeof data === 'object' && 'message' in data) {
    const value = data.message;
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (Array.isArray(value)) {
      const messages = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
      if (messages.length > 0) {
        return messages.join(', ');
      }
    }
  }
  return null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
