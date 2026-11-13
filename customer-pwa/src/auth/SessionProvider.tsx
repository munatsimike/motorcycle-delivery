import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SessionContext, type SessionContextValue, type SessionStatus } from './sessionContext';
import { logoutSession, refreshSession } from './api';
import {
  isSessionRejection,
  planSessionRestore,
  readSession,
  type AuthSession,
} from './contracts';
import { clearRegistrationProof } from './proof';

const STORAGE_KEY = 'riders.customer.session';

const refreshFlights = new Map<string, Promise<AuthSession>>();

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [session, setSession] = useState<AuthSession | null>(null);
  const sessionRef = useRef<AuthSession | null>(null);

  useEffect(() => {
    let active = true;
    const stored = loadStoredSession();
    const plan = planSessionRestore(stored, Date.now());
    if (!stored || plan.action === 'signed-out') {
      clearStoredSession();
      sessionRef.current = null;
      setSession(null);
      setStatus('signed-out');
      return;
    }
    if (plan.action === 'use') {
      sessionRef.current = stored;
      setSession(stored);
      setStatus('signed-in');
      return;
    }
    void refreshAndStore(stored)
      .then((next) => {
        if (!active) {
          return;
        }
        sessionRef.current = next;
        setSession(next);
        setStatus('signed-in');
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        if (isSessionRejection(error)) {
          clearStoredSession();
          sessionRef.current = null;
          setSession(null);
          setStatus('signed-out');
          return;
        }
        sessionRef.current = stored;
        setSession(stored);
        setStatus('signed-in');
      });
    return () => {
      active = false;
    };
  }, []);

  const saveSession = useCallback((next: AuthSession) => {
    writeStoredSession(next);
    sessionRef.current = next;
    setSession(next);
    setStatus('signed-in');
    clearRegistrationProof();
  }, []);

  const signOut = useCallback(async () => {
    const accessToken = sessionRef.current?.accessToken ?? null;
    sessionRef.current = null;
    setSession(null);
    setStatus('signed-out');
    clearStoredSession();
    clearRegistrationProof();
    if (!accessToken) {
      return;
    }
    try {
      await logoutSession(accessToken);
    } catch {
      // Local sign-out already finished.
    }
  }, []);

  const accessToken = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) {
      return null;
    }
    if (planSessionRestore(current, Date.now()).action === 'use') {
      return current.accessToken;
    }
    try {
      const next = await refreshAndStore(current);
      sessionRef.current = next;
      setSession(next);
      setStatus('signed-in');
      return next.accessToken;
    } catch (error) {
      if (isSessionRejection(error)) {
        clearStoredSession();
        sessionRef.current = null;
        setSession(null);
        setStatus('signed-out');
        return null;
      }
      throw error;
    }
  }, []);

  const value = useMemo<SessionContextValue>(() => ({
    status,
    session,
    saveSession,
    signOut,
    accessToken,
  }), [accessToken, saveSession, session, signOut, status]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

function refreshAndStore(current: AuthSession): Promise<AuthSession> {
  const existing = refreshFlights.get(current.refreshToken);
  if (existing) {
    return existing;
  }
  const flight = refreshSession(current.refreshToken)
    .then((next) => {
      writeStoredSession(next);
      return next;
    })
    .finally(() => {
      refreshFlights.delete(current.refreshToken);
    });
  refreshFlights.set(current.refreshToken, flight);
  return flight;
}

function loadStoredSession(): AuthSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return readSession(JSON.parse(raw) as unknown);
  } catch {
    clearStoredSession();
    return null;
  }
}

function writeStoredSession(session: AuthSession): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    accessTokenExpiresAt: session.accessTokenExpiresAt,
    refreshTokenExpiresAt: session.refreshTokenExpiresAt,
  }));
}

function clearStoredSession(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}
