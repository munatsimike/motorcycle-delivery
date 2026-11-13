import type { AuthSession } from '../../features/auth/domain/auth.types';

export const REFRESH_WINDOW_MS = 30_000;

export type AccessFailure = 'revoked' | 'unreachable' | 'unavailable';

export type AccessDecision =
  | { ok: true; token: string }
  | { ok: false; reason: AccessFailure };

export type SessionNotice =
  | { type: 'refreshed'; session: AuthSession }
  | { type: 'revoked' };

type SessionListener = (notice: SessionNotice) => void;

type SessionAccessOptions = {
  refresh(refreshToken: string): Promise<AuthSession>;
  save?(session: AuthSession, previousRefreshToken: string): Promise<void>;
  clear?(): Promise<void>;
  now?: () => number;
};

export function accessNeedsRefresh(session: AuthSession, now: number): boolean {
  const expiresAt = Date.parse(session.accessTokenExpiresAt);
  return !Number.isFinite(expiresAt) || expiresAt - now <= REFRESH_WINDOW_MS;
}

export function requestCanReplayAfterRefresh(
  method: string,
  path: string,
  headers?: Record<string, string>,
): boolean {
  if (method === 'GET') {
    return true;
  }
  if (headers && idempotencyKey(headers)) {
    return true;
  }
  return method === 'POST' && path.endsWith('/quote');
}

export function isRevokedRefresh(error: unknown): boolean {
  const status = statusCode(error);
  return status === 401 || status === 403;
}

export function isUnreachableRefresh(error: unknown): boolean {
  if (isRevokedRefresh(error) || statusCode(error) !== null) {
    return false;
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return true;
  }
  if (error instanceof TypeError) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  return /network request failed|timed out|check your connection/i.test(error.message);
}

export class SessionAccess {
  private session: AuthSession | null = null;
  private replacedAccessToken: string | null = null;
  private blockedRefreshToken: string | null = null;
  private flight: { token: string; promise: Promise<AccessDecision> } | null = null;
  private generation = 0;
  private readonly listeners = new Set<SessionListener>();
  private readonly now: () => number;

  constructor(private readonly options: SessionAccessOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  current(): AuthSession | null {
    return this.session;
  }

  replace(session: AuthSession | null): void {
    this.generation += 1;
    this.session = session;
    this.replacedAccessToken = null;
    this.blockedRefreshToken = null;
    this.flight = null;
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  tokenFor(presented: string): Promise<AccessDecision> {
    return this.decide(presented, false);
  }

  recover(presented: string): Promise<AccessDecision> {
    return this.decide(presented, true);
  }

  private async decide(presented: string, force: boolean): Promise<AccessDecision> {
    const session = this.session;
    if (!session || !this.owns(presented)) {
      return { ok: true, token: presented };
    }
    if (!force && !accessNeedsRefresh(session, this.now())) {
      return { ok: true, token: session.accessToken };
    }
    return this.refreshOnce(session.refreshToken);
  }

  private owns(presented: string): boolean {
    return presented === this.session?.accessToken || presented === this.replacedAccessToken;
  }

  private refreshOnce(refreshToken: string): Promise<AccessDecision> {
    if (this.blockedRefreshToken === refreshToken) {
      return Promise.resolve({ ok: false, reason: 'unreachable' });
    }
    if (this.flight?.token === refreshToken) {
      return this.flight.promise;
    }
    const generation = this.generation;
    const promise = this.lead(refreshToken, generation);
    this.flight = { token: refreshToken, promise };
    return promise.finally(() => {
      if (this.flight?.promise === promise) {
        this.flight = null;
      }
    });
  }

  private async lead(refreshToken: string, generation: number): Promise<AccessDecision> {
    try {
      const next = await this.options.refresh(refreshToken);
      if (generation !== this.generation) {
        return this.discarded();
      }
      const previousAccessToken = this.session?.accessToken ?? null;
      try {
        await this.options.save?.(next, refreshToken);
      } catch {
        // The rotated session stays in memory when secure storage cannot be rewritten yet.
      }
      if (generation !== this.generation) {
        return this.discarded();
      }
      this.replacedAccessToken = previousAccessToken;
      this.session = next;
      this.notify({ type: 'refreshed', session: next });
      return { ok: true, token: next.accessToken };
    } catch (error: unknown) {
      if (generation !== this.generation) {
        return this.discarded();
      }
      if (isRevokedRefresh(error)) {
        this.session = null;
        this.replacedAccessToken = null;
        try {
          await this.options.clear?.();
        } catch {
          // The in-memory session is already gone. The next launch loads nothing useful.
        }
        this.notify({ type: 'revoked' });
        return { ok: false, reason: 'revoked' };
      }
      if (isUnreachableRefresh(error)) {
        this.blockedRefreshToken = refreshToken;
        return { ok: false, reason: 'unreachable' };
      }
      return { ok: false, reason: 'unavailable' };
    }
  }

  private discarded(): AccessDecision {
    return this.session
      ? { ok: true, token: this.session.accessToken }
      : { ok: false, reason: 'revoked' };
  }

  private notify(notice: SessionNotice): void {
    for (const listener of this.listeners) {
      listener(notice);
    }
  }
}

function statusCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return null;
  }
  const status = error.status;
  return typeof status === 'number' ? status : null;
}

function idempotencyKey(headers: Record<string, string>): string | null {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'idempotency-key' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

let installed: SessionAccess | null = null;

export function installSessionAccess(access: SessionAccess | null): void {
  installed = access;
}

export function installedSessionAccess(): SessionAccess | null {
  return installed;
}
