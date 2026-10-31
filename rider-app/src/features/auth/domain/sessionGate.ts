import { ApiError, isUnauthorized } from './apiError';
import type { AuthSession, LogoutScope } from './auth.types';
import type { RiderAuthRepository } from './repositories/RiderAuthRepository';
import type { RiderSessionStore } from './repositories/RiderSessionStore';

const REFRESH_WINDOW_MS = 30_000;

export const RIDER_SIGNED_IN_ELSEWHERE =
  'Your account was signed in on another device. Please sign in again to continue.';

let replacementNotice: string | null = null;

export function deviceReplacementNotice(): string | null {
  return replacementNotice;
}

export function clearDeviceReplacementNotice(): void {
  replacementNotice = null;
}

function rememberDeviceReplacement(): void {
  replacementNotice = RIDER_SIGNED_IN_ELSEWHERE;
}

export class SessionExpiredError extends Error {
  constructor(message = 'Your session has ended. Sign in again.') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export class SessionReplacedError extends SessionExpiredError {
  constructor() {
    super(RIDER_SIGNED_IN_ELSEWHERE);
    this.name = 'SessionReplacedError';
  }
}

export class RiderSessionGate {
  private refreshInFlight: Promise<AuthSession> | null = null;

  constructor(
    private readonly repository: RiderAuthRepository,
    private readonly store: RiderSessionStore,
  ) {}

  async restore(now = Date.now()): Promise<AuthSession | null> {
    const stored = await this.store.load();
    if (!stored) {
      return null;
    }
    if (accessIsUsable(stored, now)) {
      return stored;
    }
    try {
      return await this.refreshStored();
    } catch (error) {
      if (isUnauthorized(error)) {
        return null;
      }
      return stored;
    }
  }

  async authorized<T>(request: (accessToken: string) => Promise<T>, now = Date.now()): Promise<T> {
    const session = await this.restore(now);
    if (!session) {
      throw new SessionExpiredError();
    }
    try {
      return await request(session.accessToken);
    } catch (error) {
      if (isDeviceReplacement(error)) {
        rememberDeviceReplacement();
        await this.store.clear();
        throw new SessionReplacedError();
      }
      if (!isUnauthorized(error)) {
        throw error;
      }
      const refreshed = await this.refreshStored();
      return request(refreshed.accessToken);
    }
  }

  refreshStored(): Promise<AuthSession> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.rotate().finally(() => {
        this.refreshInFlight = null;
      });
    }
    return this.refreshInFlight;
  }

  async logout(scope: LogoutScope): Promise<void> {
    const session = await this.store.load();
    try {
      if (session) {
        if (scope === 'all') {
          await this.repository.logoutAll(session.accessToken);
        } else {
          await this.repository.logout(session.accessToken);
        }
      }
    } finally {
      await this.store.clear();
    }
  }

  private async rotate(): Promise<AuthSession> {
    const current = await this.store.load();
    if (!current) {
      throw new SessionExpiredError();
    }
    try {
      const next = await this.repository.refresh(current.refreshToken);
      await this.store.save(next);
      return next;
    } catch (error) {
      if (isDeviceReplacement(error)) {
        rememberDeviceReplacement();
        await this.store.clear();
        throw new SessionReplacedError();
      }
      if (isUnauthorized(error)) {
        await this.store.clear();
      }
      throw error;
    }
  }
}

function isDeviceReplacement(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401 && error.message === RIDER_SIGNED_IN_ELSEWHERE;
}

function accessIsUsable(session: AuthSession, now: number): boolean {
  const expiresAt = Date.parse(session.accessTokenExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt - now > REFRESH_WINDOW_MS;
}

export function unauthorized(message = 'Authentication failed'): ApiError {
  return new ApiError(message, 401);
}
