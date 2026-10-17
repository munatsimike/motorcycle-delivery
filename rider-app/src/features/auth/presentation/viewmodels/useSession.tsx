import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { riderLocationSharing } from '../../../availability/riderLocationSharing';
import type { AuthSession, LogoutScope } from '../../domain/auth.types';
import type { RiderSessionGate } from '../../domain/sessionGate';
import { secureIdentityStore, secureSessionStore } from '../../../../services/session/secureSessionStore';
import { riderSessionGate } from '../../riderSessionGate';

type SessionStatus = 'loading' | 'signedOut' | 'signedIn';

type SessionContextValue = {
  status: SessionStatus;
  displayName: string | null;
  saveSession: (session: AuthSession, fullName?: string | null) => Promise<void>;
  logout: (scope: LogoutScope) => Promise<void>;
  expireSession: () => Promise<void>;
  gate: RiderSessionGate;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function restore() {
      try {
        const [restored, name] = await Promise.all([
          riderSessionGate.restore(),
          secureIdentityStore.load(),
        ]);
        if (!active) {
          return;
        }
        setDisplayName(restored ? name : null);
        setStatus(restored ? 'signedIn' : 'signedOut');
      } catch {
        if (active) {
          setDisplayName(null);
          setStatus('signedOut');
        }
      }
    }

    void restore();
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<SessionContextValue>(() => ({
    status,
    displayName,
    gate: riderSessionGate,
    async saveSession(session, fullName) {
      await secureSessionStore.save(session);
      if (fullName) {
        await secureIdentityStore.save(fullName);
        setDisplayName(fullName);
      } else {
        await secureIdentityStore.clear();
        setDisplayName(null);
      }
      setStatus('signedIn');
    },
    async logout(scope) {
      setDisplayName(null);
      setStatus('signedOut');
      try {
        await riderLocationSharing.prepareForSignOut();
        await riderSessionGate.logout(scope);
      } catch {
        await riderLocationSharing.stopForSignOut();
        await secureSessionStore.clear();
      } finally {
        await secureIdentityStore.clear();
      }
    },
    async expireSession() {
      setDisplayName(null);
      setStatus('signedOut');
      await riderLocationSharing.stopForSignOut();
      await secureSessionStore.clear();
      await secureIdentityStore.clear();
    },
  }), [displayName, status]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error('SessionProvider is missing');
  }
  return value;
}
