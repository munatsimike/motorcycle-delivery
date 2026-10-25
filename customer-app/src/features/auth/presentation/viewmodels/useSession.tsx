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
import { restoreSession, type SessionRestore } from '../../domain/usecases/restoreSession';
import { confirmCustomerIdentity, customerIdForSession } from '../../../../services/session/customerIdentity';
import { reconcileInstallMarker } from '../../../../services/session/installMarker';
import { secureSessionStore } from '../../../../services/session/secureSessionStore';
import { removeCustomerPushDevice } from '../../../notifications/data/customerPushApi';
import { pushRegistrationStore } from '../../../notifications/data/pushRegistrationStore';
import { PUSH_DEREGISTER_FAILED, removePushRegistration } from '../../../notifications/domain/customerPushRegistration';

type SessionStatus = 'loading' | 'signedOut' | 'needsConnection' | 'signedIn';

type SessionContextValue = {
  status: SessionStatus;
  accessToken: string | null;
  customerId: string | null;
  saveSession: (session: AuthSession) => Promise<void>;
  confirmCustomer: (customerId: string) => Promise<void>;
  logout: () => Promise<void>;
  logoutNotice: string | null;
  retryRestore: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [logoutNotice, setLogoutNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function restore() {
      try {
        const install = await reconcileInstallMarker();
        if (!active) {
          return;
        }
        if (install === 'reinstall') {
          await secureSessionStore.clear();
          setCustomerId(null);
          setSession(null);
          setStatus('signedOut');
          return;
        }
        const restored = await restoreSession(customerAuthRepository, secureSessionStore);
        if (!active) {
          return;
        }
        const next = await readRestoredCustomer(restored);
        if (!active) {
          return;
        }
        applyRestoredCustomer(next, setSession, setCustomerId, setStatus);
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
    accessToken: session?.accessToken ?? null,
    customerId,
    logoutNotice,
    async saveSession(next) {
      setLogoutNotice(null);
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
      const knownCustomerId = customerId;
      const accessToken = session?.accessToken ?? null;
      const pushRemoval = await removePushRegistration({
        accessToken,
        store: pushRegistrationStore,
        remove: removeCustomerPushDevice,
      });
      setLogoutNotice(pushRemoval === 'failed' ? PUSH_DEREGISTER_FAILED : null);
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
      await logoutCustomer(customerAuthRepository, secureSessionStore, accessToken);
    },
    async retryRestore() {
      const restored = await restoreSession(customerAuthRepository, secureSessionStore);
      const next = await readRestoredCustomer(restored);
      applyRestoredCustomer(next, setSession, setCustomerId, setStatus);
    },
  }), [customerId, logoutNotice, session, status]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error('SessionProvider is missing');
  }
  return value;
}

type RestoredCustomer =
  | { status: 'signedIn'; session: AuthSession; customerId: string | null }
  | { status: 'needsConnection' }
  | { status: 'signedOut' };

async function readRestoredCustomer(restored: SessionRestore): Promise<RestoredCustomer> {
  if (restored.status === 'offline') {
    return { status: 'needsConnection' };
  }
  if (restored.status !== 'ready') {
    return { status: 'signedOut' };
  }
  const identity = await loadCustomerIdentity();
  return {
    status: 'signedIn',
    session: restored.session,
    customerId: customerIdForSession(identity, restored.session.refreshToken),
  };
}

function applyRestoredCustomer(
  next: RestoredCustomer,
  setSession: (session: AuthSession | null) => void,
  setCustomerId: (customerId: string | null) => void,
  setStatus: (status: SessionStatus) => void,
) {
  if (next.status === 'signedIn') {
    setSession(next.session);
    setCustomerId(next.customerId);
    setStatus('signedIn');
    return;
  }
  setSession(null);
  setCustomerId(null);
  setStatus(next.status === 'needsConnection' ? 'needsConnection' : 'signedOut');
}
