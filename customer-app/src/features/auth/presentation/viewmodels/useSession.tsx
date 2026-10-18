import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  clearCustomerIdentity,
  clearRecentDeliveries,
  loadCustomerIdentity,
  saveCustomerIdentity,
} from '../../../deliveries/data/recentDeliveryStore';
import { customerAuthRepository } from '../../data/repositories/CustomerAuthApiRepository';
import type { AuthSession } from '../../domain/auth.types';
import { logoutCustomer } from '../../domain/usecases/logoutCustomer';
import { restoreSession } from '../../domain/usecases/restoreSession';
import { authenticateForSession, canUseBiometrics } from '../../../../services/session/biometricUnlock';
import { confirmCustomerIdentity, customerIdForSession } from '../../../../services/session/customerIdentity';
import { secureSessionStore } from '../../../../services/session/secureSessionStore';

type SessionStatus = 'loading' | 'signedOut' | 'locked' | 'signedIn';

export type BiometricUpdate = 'enabled' | 'disabled' | 'cancelled' | 'unavailable';

type SessionContextValue = {
  status: SessionStatus;
  biometricAvailable: boolean;
  biometricEnabled: boolean;
  accessToken: string | null;
  customerId: string | null;
  saveSession: (session: AuthSession) => Promise<void>;
  confirmCustomer: (customerId: string) => Promise<void>;
  logout: () => Promise<void>;
  unlock: () => Promise<boolean>;
  setBiometricEnabled: (enabled: boolean) => Promise<BiometricUpdate>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
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
          setCustomerId(null);
          setSession(null);
          setStatus('signedOut');
          return;
        }
        const identity = await loadCustomerIdentity();
        if (!active) {
          return;
        }
        setCustomerId(customerIdForSession(identity, restored.refreshToken));
        setSession(restored);
        setStatus('signedIn');
      } catch {
        if (active) {
          setCustomerId(null);
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
    customerId,
    async saveSession(next) {
      await secureSessionStore.save(next);
      setCustomerId(null);
      setSession(next);
      setStatus('signedIn');
    },
    async confirmCustomer(nextCustomerId) {
      const refreshToken = session?.refreshToken;
      if (!refreshToken) {
        return;
      }
      const current = await loadCustomerIdentity();
      const update = confirmCustomerIdentity(current, nextCustomerId, refreshToken);
      if (!update) {
        return;
      }
      if (update.replacedCustomerId) {
        await clearRecentDeliveries(update.replacedCustomerId);
      }
      await saveCustomerIdentity(update.identity);
      setCustomerId(update.identity.customerId);
    },
    async logout() {
      const accessToken = session?.accessToken;
      const knownCustomerId = customerId;
      setCustomerId(null);
      setSession(null);
      setStatus('signedOut');
      try {
        if (knownCustomerId) {
          await clearRecentDeliveries(knownCustomerId);
        }
        await clearCustomerIdentity();
      } catch {
        // Signing out still continues when the saved deliveries cannot be removed.
      }
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
        setCustomerId(null);
        setSession(null);
        setStatus('signedOut');
        return false;
      }
      const identity = await loadCustomerIdentity();
      setCustomerId(customerIdForSession(identity, restored.refreshToken));
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
  }), [biometricAvailable, biometricEnabled, customerId, session, status]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error('SessionProvider is missing');
  }
  return value;
}
