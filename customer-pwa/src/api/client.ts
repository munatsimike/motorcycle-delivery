import { apiBaseUrl } from '../config/env';

const REQUEST_TIMEOUT_MS = 15_000;
const ROUTE_MISS = /^Cannot (GET|POST|PUT|PATCH|DELETE) \//;
const SERVICE_UNAVAILABLE = 'This service is not available right now.';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export class InvalidResponseError extends Error {
  constructor(status: number) {
    super(`Invalid response from server (${status}).`);
    this.name = 'InvalidResponseError';
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: HeadersInit;
  accessToken?: string;
};

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers = new Headers(options.headers);
  headers.set('Accept', headers.get('Accept') ?? 'application/json');
  if (options.accessToken) {
    headers.set('Authorization', `Bearer ${options.accessToken}`);
  }
  const hasBody = options.body !== undefined;
  if (hasBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  try {
    const response = await fetch(`${apiBaseUrl()}${path}`, {
      method: options.method ?? (hasBody ? 'POST' : 'GET'),
      headers,
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    if (response.status === 204) {
      return undefined as T;
    }
    const payload = await readBody(response);
    if (!response.ok) {
      throw new ApiError(messageFrom(payload, response.status), response.status);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError || error instanceof InvalidResponseError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('The request timed out. Check your connection and try again.');
    }
    throw new Error('Network request failed. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
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
  const message = rawMessage(data);
  if (message && !ROUTE_MISS.test(message)) {
    return message;
  }
  if (message) {
    return SERVICE_UNAVAILABLE;
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
