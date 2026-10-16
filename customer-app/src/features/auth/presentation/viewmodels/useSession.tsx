import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { customerAuthRepository } from '../../data/repositories/CustomerAuthApiRepository';
import type { AuthSession } from '../../domain/auth.types';
import { logoutCustomer } from '../../domain/usecases/logoutCustomer';
import { restoreSession } from '../../domain/usecases/restoreSession';
import { authenticateForSession, canUseBiometrics } from '../../../../services/session/biometricUnlock';
import { secureSessionStore } from '../../../../services/session/secureSessionStore';

type SessionStatus = 'loading' | 'signedOut' | 'locked' | 'signedIn';

export type BiometricUpdate = 'enabled' | 'disabled' | 'cancelled' | 'unavailable';

type SessionContextValue = {
  status: SessionStatus;
  biometricAvailable: boolean;
  biometricEnabled: boolean;
  accessToken: string | null;
  saveSession: (session: AuthSession) => Promise<void>;
  logout: () => Promise<void>;
  unlock: () => Promise<boolean>;
  setBiometricEnabled: (enabled: boolean) => Promise<BiometricUpdate>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabledState] = useState(false);

  useEffect(() => {
    let active = true;

    async function restore() {
      try {
        const [available, enabled] = await Promise.all([
          canUseBiometrics(),
          secureSessionStore.loadBiometricEnabled(),
        ]);
        if (!active) {
          return;
        }
        setBiometricAvailable(available);
        setBiometricEnabledState(enabled && available);
        const stored = await secureSessionStore.load();
        if (!active) {
          return;
        }
        if (!stored) {
          setStatus('signedOut');
          return;
        }
        if (enabled && available) {
          setStatus('locked');
          return;
        }
        const restored = await restoreSession(customerAuthRepository, secureSessionStore);
        if (!active) {
          return;
        }
        if (!restored) {
          setSession(null);
          setStatus('signedOut');
          return;
        }
        setSession(restored);
        setStatus('signedIn');
      } catch {
        if (active) {
          setSession(null);
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
    biometricAvailable,
    biometricEnabled,
    accessToken: session?.accessToken ?? null,
    async saveSession(next) {
      await secureSessionStore.save(next);
      setSession(next);
      setStatus('signedIn');
    },
    async logout() {
      const accessToken = session?.accessToken;
      setSession(null);
      setStatus('signedOut');
      try {
        if (!accessToken) {
          await secureSessionStore.clear();
          return;
        }
        await logoutCustomer(customerAuthRepository, secureSessionStore, accessToken);
      } catch {
        await secureSessionStore.clear();
      }
    },
    async unlock() {
      const authenticated = await authenticateForSession();
      if (!authenticated) {
        return false;
      }
      const restored = await restoreSession(customerAuthRepository, secureSessionStore);
      if (!restored) {
        setSession(null);
        setStatus('signedOut');
        return false;
      }
      setSession(restored);
      setStatus('signedIn');
      return true;
    },
    async setBiometricEnabled(enabled) {
      if (!enabled) {
        await secureSessionStore.saveBiometricEnabled(false);
        setBiometricEnabledState(false);
        return 'disabled';
      }
      const available = await canUseBiometrics();
      setBiometricAvailable(available);
      if (!available) {
        return 'unavailable';
      }
      const authenticated = await authenticateForSession();
      if (!authenticated) {
        return 'cancelled';
      }
      await secureSessionStore.saveBiometricEnabled(true);
      setBiometricEnabledState(true);
      return 'enabled';
    },
  }), [biometricAvailable, biometricEnabled, session, status]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error('SessionProvider is missing');
  }
  return value;
}
