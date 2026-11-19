import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { clearStoredProfile } from '../account/profileLoad';
import { setUnauthorizedRecovery } from '../api/client';
import { SessionContext, type SessionContextValue, type SessionStatus } from './sessionContext';
import { logoutSession, refreshSession } from './api';
import {
  clearPersistedSession,
  CUSTOMER_SESSION_STORAGE_KEY,
  isRefreshTransportFailure,
  isSessionRejection,
  nextAccessAfterBlockedRefresh,
  planSessionRestore,
  readPersistedSession,
  sameSession,
  sessionFromStorageValue,
  writePersistedSession,
  type AuthSession,
} from './contracts';
import { clearRegistrationProof } from './proof';
import { detachCustomerPush } from '../pwa/pushApi';
import {
  blockRefreshToken,
  browserRefreshLock,
  clearBlockedRefreshTokens,
  clearCustomerSessionIfCurrent,
  createCustomerRefresher,
  logoutUnderRefreshLock,
  readBlockedRefreshTokens,
} from './refreshCoordination';

const blockedInThisTab = new Set<string>();

const customerRefresh = createCustomerRefresher({
  getLock: browserRefreshLock,
  read: loadStoredSession,
  write: storeSession,
  remove: removeStoredSession,
  isBlocked: (token) => blockedInThisTab.has(token) || blockedInStorage(token),
  block: (token) => {
    blockedInThisTab.add(token);
    try {
      blockRefreshToken(localStorage, token);
    } catch {
      // This tab still remembers the token and will not send it again.
    }
  },
  now: () => Date.now(),
  refresh: refreshSession,
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [session, setSession] = useState<AuthSession | null>(null);
  const sessionRef = useRef<AuthSession | null>(null);

  const adopt = useCallback((next: AuthSession | null, nextStatus: SessionStatus) => {
    if (!next) clearStoredProfile();
    sessionRef.current = next;
    setSession(next);
    setStatus(nextStatus);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const stored = loadStoredSession();
      const plan = planSessionRestore(stored, Date.now());
      if (!stored || plan.action === 'signed-out') {
        if (stored) {
          const kept = await clearCustomerSessionIfCurrent({
            lock: browserRefreshLock(),
            refreshToken: stored.refreshToken,
            read: loadStoredSession,
            remove: removeStoredSession,
          });
          if (!active) return;
          if (kept) {
            adopt(kept, 'signed-in');
            return;
          }
        }
        if (active) adopt(null, 'signed-out');
        return;
      }
      if (plan.action === 'use') {
        adopt(stored, 'signed-in');
        return;
      }
      try {
        const next = await customerRefresh.refresh(stored);
        if (active) adopt(next, 'signed-in');
      } catch (error: unknown) {
        if (!active) return;
        if (isSessionRejection(error) || isRefreshTransportFailure(error)) {
          const kept = await settleRejectedRefresh(stored.refreshToken);
          if (!active) return;
          adopt(kept, kept ? 'signed-in' : 'signed-out');
          return;
        }
        adopt(stored, 'signed-in');
      }
    })();
    return () => {
      active = false;
    };
  }, [adopt]);

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== CUSTOMER_SESSION_STORAGE_KEY || event.storageArea !== localStorage) return;
      const next = sessionFromStorageValue(event.newValue);
      if (!next) {
        blockedInThisTab.clear();
        adopt(null, 'signed-out');
        return;
      }
      adopt(next, 'signed-in');
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [adopt]);

  useEffect(() => {
    setUnauthorizedRecovery(async () => {
      const current = loadStoredSession();
      if (!current) return null;
      if (blockedInThisTab.has(current.refreshToken) || blockedInStorage(current.refreshToken)) {
        if (nextAccessAfterBlockedRefresh(current, Date.now()) === 'use') return null;
        const kept = await settleRejectedRefresh(current.refreshToken);
        adopt(kept, kept ? 'signed-in' : 'signed-out');
        return kept?.accessToken ?? null;
      }
      try {
        const next = await customerRefresh.refresh(current);
        adopt(next, 'signed-in');
        return next.accessToken;
      } catch (error) {
        if (!isSessionRejection(error) && !isRefreshTransportFailure(error)) return null;
        const kept = await settleRejectedRefresh(current.refreshToken);
        adopt(kept, kept ? 'signed-in' : 'signed-out');
        return kept?.accessToken ?? null;
      }
    });
    return () => setUnauthorizedRecovery(null);
  }, [adopt]);

  const saveSession = useCallback((next: AuthSession) => {
    clearStoredProfile();
    storeSession(next);
    adopt(next, 'signed-in');
    clearRegistrationProof();
  }, [adopt]);

  const signOut = useCallback(async () => {
    const current = loadStoredSession() ?? sessionRef.current;
    if (current?.accessToken) {
      await detachCustomerPush(current.accessToken);
    }
    await logoutUnderRefreshLock({
      lock: browserRefreshLock(),
      read: () => loadStoredSession() ?? (sessionRef.current ? { ...sessionRef.current } : null),
      clear: () => {
        removeStoredSession();
        adopt(null, 'signed-out');
      },
      revoke: async (accessToken) => {
        clearRegistrationProof();
        if (!accessToken) return;
        try {
          await logoutSession(accessToken);
        } catch {
          // Local sign-out already finished.
        }
      },
    });
  }, [adopt]);

  const accessToken = useCallback(async () => {
    const current = loadStoredSession();
    if (!current) {
      if (sessionRef.current) adopt(null, 'signed-out');
      return null;
    }
    if (!sameSession(current, sessionRef.current)) adopt(current, 'signed-in');
    const plan = planSessionRestore(current, Date.now());
    if (plan.action === 'signed-out') {
      const kept = await settleRejectedRefresh(current.refreshToken);
      adopt(kept, kept ? 'signed-in' : 'signed-out');
      return kept?.accessToken ?? null;
    }
    if (plan.action === 'use') return current.accessToken;
    if (blockedInThisTab.has(current.refreshToken) || blockedInStorage(current.refreshToken)) {
      if (nextAccessAfterBlockedRefresh(current, Date.now()) === 'use') return current.accessToken;
      const kept = await settleRejectedRefresh(current.refreshToken);
      adopt(kept, kept ? 'signed-in' : 'signed-out');
      return kept?.accessToken ?? null;
    }
    try {
      const next = await customerRefresh.refresh(current);
      adopt(next, 'signed-in');
      return next.accessToken;
    } catch (error) {
      if (!isSessionRejection(error) && !isRefreshTransportFailure(error)) throw error;
      const kept = await settleRejectedRefresh(current.refreshToken);
      adopt(kept, kept ? 'signed-in' : 'signed-out');
      return kept?.accessToken ?? null;
    }
  }, [adopt]);

  const value = useMemo<SessionContextValue>(() => ({
    status,
    session,
    saveSession,
    signOut,
    accessToken,
  }), [accessToken, saveSession, session, signOut, status]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

function settleRejectedRefresh(refreshToken: string): Promise<AuthSession | null> {
  return clearCustomerSessionIfCurrent({
    lock: browserRefreshLock(),
    refreshToken,
    read: loadStoredSession,
    remove: removeStoredSession,
  });
}

function storeSession(next: AuthSession): void {
  writePersistedSession(next, localStorage);
  sessionStorage.removeItem(CUSTOMER_SESSION_STORAGE_KEY);
}

function removeStoredSession(): void {
  clearPersistedSession(localStorage, sessionStorage);
  clearBlockedRefreshTokens(localStorage);
  blockedInThisTab.clear();
}

function loadStoredSession(): AuthSession | null {
  try {
    return readPersistedSession(localStorage, sessionStorage);
  } catch {
    return null;
  }
}

function blockedInStorage(token: string): boolean {
  try {
    return readBlockedRefreshTokens(localStorage).includes(token);
  } catch {
    return false;
  }
}
