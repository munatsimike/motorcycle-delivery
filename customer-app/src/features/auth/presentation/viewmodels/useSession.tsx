import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

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
import { sessionGate } from '../../domain/sessionGate';
import { confirmCustomerIdentity, customerIdForSession } from '../../../../services/session/customerIdentity';
import { BiometricPromptCancelled, supportsBiometricCredentialProtection } from '../../../../services/session/credentialAccess';
import { authenticateForSession, canUseBiometrics } from '../../../../services/session/biometricUnlock';
import { reconcileInstallMarker } from '../../../../services/session/installMarker';
import { osBiometricProtectionAvailable, secureSessionStore } from '../../../../services/session/secureSessionStore';
import { removeCustomerPushDevice } from '../../../notifications/data/customerPushApi';
import { pushRegistrationStore } from '../../../notifications/data/pushRegistrationStore';
import { PUSH_DEREGISTER_FAILED, removePushRegistration } from '../../../notifications/domain/customerPushRegistration';

type SessionStatus = 'loading' | 'signedOut' | 'locked' | 'needsConnection' | 'offerBiometric' | 'signedIn';

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
  logoutNotice: string | null;
  unlock: () => Promise<'restored' | 'cancelled' | 'offline' | 'signed-out'>;
  retryRestore: () => Promise<void>;
  acceptBiometricOffer: () => Promise<BiometricUpdate>;
  declineBiometricOffer: () => Promise<void>;
  setBiometricEnabled: (enabled: boolean) => Promise<BiometricUpdate>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabledState] = useState(false);
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
          await secureSessionStore.saveBiometricEnabled(false);
          setCustomerId(null);
          setSession(null);
          setBiometricEnabledState(false);
          setStatus('signedOut');
          return;
        }
        const [available, enabled, protectedSession] = await Promise.all([
          canUseBiometrics(),
          secureSessionStore.loadBiometricEnabled(),
          secureSessionStore.isProtected(),
        ]);
        if (!active) {
          return;
        }
        const osAvailable = osBiometricProtectionAvailable();
        const credentialProtection = protectedSession || (biometricProtectionSupported() && enabled);
        setBiometricAvailable(credentialProtection && available && osAvailable);
        setBiometricEnabledState(credentialProtection && available && osAvailable);
        if (protectedSession && !osAvailable) {
          await secureSessionStore.clear();
          await secureSessionStore.saveBiometricEnabled(false);
          setStatus('signedOut');
          return;
        }
        const gate = sessionGate({
          hasStoredSession: await secureSessionStore.hasSession(),
          biometricEnabled: credentialProtection,
          biometricAvailable: available && osAvailable,
        });
        if (!active) {
          return;
        }
        if (gate === 'signed-out') {
          setStatus('signedOut');
          return;
        }
        if (gate === 'biometric' || gate === 'biometric-unavailable') {
          setStatus('locked');
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
    biometricAvailable,
    biometricEnabled,
    accessToken: session?.accessToken ?? null,
    customerId,
    logoutNotice,
    async saveSession(next) {
      setLogoutNotice(null);
      await secureSessionStore.save(next);
      setCustomerId(null);
      setSession(next);
      const [enabled, declined, available] = await Promise.all([
        secureSessionStore.loadBiometricEnabled(),
        secureSessionStore.loadBiometricDeclined(),
        canUseBiometrics(),
      ]);
      if (
        biometricProtectionSupported()
        && !enabled
        && !declined
        && available
        && osBiometricProtectionAvailable()
      ) {
        setBiometricAvailable(true);
        setStatus('offerBiometric');
        return;
      }
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
      setBiometricEnabledState(false);
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
        await logoutCustomer(customerAuthRepository, secureSessionStore, accessToken);
      } catch {
        await secureSessionStore.saveBiometricEnabled(false);
        await secureSessionStore.clear();
      }
    },
    async unlock() {
      try {
        const protectedSession = await secureSessionStore.isProtected();
        let preloaded: AuthSession | null = null;
        if (!protectedSession) {
          if (!biometricAvailable) {
            return 'cancelled';
          }
        if (Platform.OS === 'ios') {
            const authenticated = await authenticateForSession();
            if (!authenticated) {
              return 'cancelled';
            }
          }
          preloaded = await secureSessionStore.load();
          if (!preloaded) {
            setStatus('signedOut');
            return 'signed-out';
          }
          if (biometricProtectionSupported() && osBiometricProtectionAvailable()) {
            await secureSessionStore.protect(preloaded);
            setBiometricEnabledState(true);
          }
        }
        const restored = await restoreSession(
          customerAuthRepository,
          secureSessionStore,
          Date.now(),
          preloaded,
          { requireLiveSession: true },
        );
        const next = await readRestoredCustomer(restored);
        applyRestoredCustomer(next, setSession, setCustomerId, setStatus);
        if (next.status === 'signedIn') {
          return 'restored';
        }
        return next.status === 'needsConnection' ? 'offline' : 'signed-out';
      } catch (error: unknown) {
        if (error instanceof BiometricPromptCancelled) {
          return 'cancelled';
        }
        return 'cancelled';
      }
    },
    async retryRestore() {
      const restored = await restoreSession(customerAuthRepository, secureSessionStore);
      const next = await readRestoredCustomer(restored);
      applyRestoredCustomer(next, setSession, setCustomerId, setStatus);
    },
    async acceptBiometricOffer() {
      if (!session) {
        return 'unavailable';
      }
      const enabled = await enableStoredBiometric(session);
      if (enabled === 'enabled') {
        setBiometricEnabledState(true);
        setStatus('signedIn');
      }
      return enabled;
    },
    async declineBiometricOffer() {
      await secureSessionStore.declineBiometricOffer();
      setStatus('signedIn');
    },
    async setBiometricEnabled(enabled) {
      if (!enabled) {
        if (session) {
          await secureSessionStore.release(session);
        } else {
          await secureSessionStore.saveBiometricEnabled(false);
          await secureSessionStore.clear();
        }
        setBiometricEnabledState(false);
        return 'disabled';
      }
      const result = session ? await enableStoredBiometric(session) : 'unavailable';
      if (result === 'enabled') {
        setBiometricEnabledState(true);
        setBiometricAvailable(true);
      }
      return result;
    },
  }), [biometricAvailable, biometricEnabled, customerId, logoutNotice, session, status]);

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

function biometricProtectionSupported(): boolean {
  return supportsBiometricCredentialProtection(Platform.OS === 'ios' ? 'ios' : 'android');
}

async function enableStoredBiometric(current: AuthSession): Promise<BiometricUpdate> {
  const available = await canUseBiometrics();
  if (!biometricProtectionSupported() || !available || !osBiometricProtectionAvailable()) {
    return 'unavailable';
  }
  if (Platform.OS === 'ios') {
    const authenticated = await authenticateForSession();
    if (!authenticated) {
      return 'cancelled';
    }
  }
  try {
    await secureSessionStore.protect(current);
    return 'enabled';
  } catch (error: unknown) {
    if (error instanceof BiometricPromptCancelled) {
      return 'cancelled';
    }
    return 'cancelled';
  }
}
