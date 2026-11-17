import {
  isRefreshTransportFailure,
  isSessionRejection,
  nextAccessAfterBlockedRefresh,
  type AuthSession,
  type KeyValueStore,
} from './contracts.ts';

export const CUSTOMER_REFRESH_LOCK_NAME = 'riders.customer.session.refresh';
export const BLOCKED_REFRESH_STORAGE_KEY = 'riders.customer.refresh.blocked';

export class SessionRejected extends Error {
  readonly status = 401;

  constructor() {
    super('Authentication failed.');
    this.name = 'SessionRejected';
  }
}

export type RefreshLock = {
  exclusive<T>(work: () => Promise<T>): Promise<T>;
};

export type CustomerRefreshShared = {
  getLock: () => RefreshLock | null;
  read: () => AuthSession | null;
  write: (session: AuthSession) => void;
  remove: () => void;
  isBlocked: (token: string) => boolean;
  block: (token: string) => void;
  now: () => number;
  refresh: (refreshToken: string) => Promise<AuthSession>;
};

export function browserRefreshLock(): RefreshLock | null {
  if (typeof navigator === 'undefined' || typeof navigator.locks?.request !== 'function') {
    return null;
  }
  const locks = navigator.locks;
  return {
    exclusive<T>(work: () => Promise<T>): Promise<T> {
      return locks.request(CUSTOMER_REFRESH_LOCK_NAME, { mode: 'exclusive' }, () => work()).then((value) => value);
    },
  };
}

export function queueRefreshLock(): RefreshLock {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    exclusive<T>(work: () => Promise<T>): Promise<T> {
      const run = tail.then(() => work());
      tail = run.then(() => undefined, () => undefined);
      return run;
    },
  };
}

export function readBlockedRefreshTokens(storage: KeyValueStore): string[] {
  const raw = storage.getItem(BLOCKED_REFRESH_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      storage.removeItem(BLOCKED_REFRESH_STORAGE_KEY);
      return [];
    }
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(-5);
  } catch {
    storage.removeItem(BLOCKED_REFRESH_STORAGE_KEY);
    return [];
  }
}

export function blockRefreshToken(storage: KeyValueStore, token: string): void {
  const next = readBlockedRefreshTokens(storage).filter((item) => item !== token);
  next.push(token);
  storage.setItem(BLOCKED_REFRESH_STORAGE_KEY, JSON.stringify(next.slice(-5)));
}

export function clearBlockedRefreshTokens(storage: KeyValueStore): void {
  storage.removeItem(BLOCKED_REFRESH_STORAGE_KEY);
}

export function createCustomerRefresher(shared: CustomerRefreshShared): {
  refresh: (expected: AuthSession) => Promise<AuthSession>;
} {
  const flights = new Map<string, Promise<AuthSession>>();
  return {
    refresh(expected) {
      const existing = flights.get(expected.refreshToken);
      if (existing) return existing;
      const flight = refreshCustomerSession({
        ...shared,
        lock: shared.getLock(),
        expectedRefreshToken: expected.refreshToken,
        now: shared.now(),
      }).finally(() => {
        flights.delete(expected.refreshToken);
      });
      flights.set(expected.refreshToken, flight);
      return flight;
    },
  };
}

type HeldRefresh = Omit<CustomerRefreshShared, 'now' | 'getLock'> & {
  lock: RefreshLock | null;
  expectedRefreshToken: string;
  now: number;
};

export async function refreshCustomerSession(deps: HeldRefresh): Promise<AuthSession> {
  if (!deps.lock) return refreshWhileHeld(deps, false);
  let entered = false;
  try {
    return await deps.lock.exclusive(async () => {
      entered = true;
      return refreshWhileHeld(deps, true);
    });
  } catch (error) {
    if (!entered) return refreshWhileHeld(deps, false);
    throw error;
  }
}

export async function clearCustomerSessionIfCurrent(deps: {
  lock: RefreshLock | null;
  refreshToken: string;
  read: () => AuthSession | null;
  remove: () => void;
}): Promise<AuthSession | null> {
  const run = (): AuthSession | null => {
    const stored = deps.read();
    if (stored && stored.refreshToken !== deps.refreshToken) return stored;
    if (!stored || stored.refreshToken === deps.refreshToken) deps.remove();
    return null;
  };
  if (!deps.lock) return run();
  let entered = false;
  try {
    return await deps.lock.exclusive(async () => {
      entered = true;
      return run();
    });
  } catch (error) {
    if (!entered) return run();
    throw error;
  }
}

export async function logoutUnderRefreshLock(deps: {
  lock: RefreshLock | null;
  read: () => AuthSession | null;
  clear: () => void;
  revoke: (accessToken: string | null) => Promise<void>;
}): Promise<void> {
  const run = async () => {
    const token = deps.read()?.accessToken ?? null;
    deps.clear();
    await deps.revoke(token);
  };
  if (!deps.lock) {
    await run();
    return;
  }
  let entered = false;
  try {
    await deps.lock.exclusive(async () => {
      entered = true;
      await run();
    });
  } catch (error) {
    if (!entered) {
      await run();
      return;
    }
    throw error;
  }
}

async function refreshWhileHeld(deps: HeldRefresh, allowNetwork: boolean): Promise<AuthSession> {
  const stored = deps.read();
  if (!stored) throw new SessionRejected();
  if (stored.refreshToken !== deps.expectedRefreshToken) return stored;
  if (deps.isBlocked(stored.refreshToken) || !allowNetwork) return keepOrReject(deps, stored);
  try {
    const next = await deps.refresh(stored.refreshToken);
    const after = deps.read();
    if (!after || after.refreshToken !== stored.refreshToken) {
      if (after) return after;
      throw new SessionRejected();
    }
    deps.write(next);
    return next;
  } catch (error) {
    if (error instanceof SessionRejected) throw error;
    if (isRefreshTransportFailure(error)) {
      deps.block(stored.refreshToken);
      const after = deps.read();
      if (after && after.refreshToken !== stored.refreshToken) return after;
      const usable = after ?? stored;
      if (nextAccessAfterBlockedRefresh(usable, deps.now) === 'use') return usable;
      throw error;
    }
    if (isSessionRejection(error)) {
      const after = deps.read();
      if (after && after.refreshToken !== stored.refreshToken) return after;
      if (!after || after.refreshToken === stored.refreshToken) deps.remove();
    }
    throw error;
  }
}

function keepOrReject(deps: Pick<HeldRefresh, 'read' | 'remove' | 'now'>, stored: AuthSession): AuthSession {
  const after = deps.read();
  if (after && after.refreshToken !== stored.refreshToken) return after;
  const usable = after ?? stored;
  if (nextAccessAfterBlockedRefresh(usable, deps.now) === 'use') return usable;
  if (!after || after.refreshToken === stored.refreshToken) deps.remove();
  throw new SessionRejected();
}
