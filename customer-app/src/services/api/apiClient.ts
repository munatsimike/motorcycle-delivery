import { Platform } from 'react-native';

import { resolveApiBaseUrl } from './apiBaseUrl';

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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { Accept: 'image/png' };
    if (options?.accessToken) {
      headers.Authorization = `Bearer ${options.accessToken}`;
    }
    const response = await fetch(`${apiBaseUrl()}${path}`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
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

export function apiDelete<TResponse>(path: string, options?: RequestOptions): Promise<TResponse> {
  return apiRequest<TResponse>(path, { method: 'DELETE' }, options);
}

async function apiRequest<TResponse>(
  path: string,
  init: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: string },
  options?: RequestOptions,
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
    if (options?.accessToken) {
      headers.Authorization = `Bearer ${options.accessToken}`;
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

function apiBaseUrl(): string {
  return resolveApiBaseUrl({
    configured: process.env.EXPO_PUBLIC_API_BASE_URL,
    dev: typeof __DEV__ === 'boolean' ? __DEV__ : false,
    platform: Platform.OS,
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

function messageFrom(data: unknown, status: number): string {
  if (data && typeof data === 'object' && 'message' in data) {
    const value = data.message;
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
    if (Array.isArray(value)) {
      const messages = value.filter((item): item is string => typeof item === 'string');
      if (messages.length > 0) {
        return messages.join(', ');
      }
    }
  }
  return `Request failed (${status}).`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
