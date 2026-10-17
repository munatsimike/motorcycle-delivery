import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { SessionExpiredError } from '../../auth/domain/sessionGate';
import { errorMessage } from '../../auth/presentation/errorMessage';
import { useSession } from '../../auth/presentation/viewmodels/useSession';
import type { RiderOnboarding } from '../../onboarding/domain/riderOnboarding';
import { riderLocationSharing, type SharingSnapshot } from '../riderLocationSharing';
import { AVAILABILITY_RECONCILE_INTERVAL_MS } from '../domain/sharingPolicy';

type Reload = (mode?: 'initial' | 'quiet') => Promise<void>;

export function useRiderAvailability(onboarding: RiderOnboarding | null, reload: Reload) {
  const { expireSession } = useSession();
  const [snapshot, setSnapshot] = useState<SharingSnapshot>(riderLocationSharing.getSnapshot());
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const sync = useCallback(() => {
    setSnapshot(riderLocationSharing.getSnapshot());
    if (riderLocationSharing.consumeSessionExpired()) {
      void expireSession();
      return;
    }
    if (riderLocationSharing.consumeServerChange()) {
      void reload('quiet');
    }
  }, [expireSession, reload]);

  useEffect(() => riderLocationSharing.subscribe(sync), [sync]);

  useEffect(() => {
    const apply = (state: string) => {
      riderLocationSharing.setAppForeground(state === 'active');
      if (state === 'active') {
        void riderLocationSharing.probe();
      }
    };
    apply(AppState.currentState);
    const subscription = AppState.addEventListener('change', apply);
    return () => subscription.remove();
  }, []);

  const availability = onboarding?.availability;

  useEffect(() => {
    if (!availability) {
      return;
    }
    void riderLocationSharing.applyServerAvailability(availability);
  }, [availability]);

  useEffect(() => {
    if (availability !== 'AVAILABLE' && availability !== 'BUSY') {
      return;
    }
    const timer = setInterval(() => {
      void reload('quiet');
      void riderLocationSharing.applyServerAvailability(availability);
    }, AVAILABILITY_RECONCILE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [availability, reload]);

  async function online() {
    if (!onboarding || working) {
      return;
    }
    setWorking(true);
    setActionError(null);
    try {
      const result = await riderLocationSharing.goOnline(onboarding);
      if (result.status === 'online' || result.status === 'offline' || result.status === 'refused' || result.status === 'unconfirmed') {
        await reload('quiet');
      }
      if (result.status !== 'online') {
        setActionError(result.message || null);
      }
    } catch (caught) {
      if (caught instanceof SessionExpiredError) {
        await expireSession();
        return;
      }
      setActionError(errorMessage(caught, 'You could not go online. Check your connection and try again.'));
    } finally {
      setWorking(false);
    }
  }

  async function offline() {
    if (!onboarding || working) {
      return;
    }
    setWorking(true);
    setActionError(null);
    try {
      const result = await riderLocationSharing.goOffline(onboarding);
      await reload('quiet');
      if (result.status === 'unconfirmed' || result.status === 'blocked' || result.status === 'refused' || result.status === 'location') {
        setActionError(result.message);
      } else if (result.status === 'offline' && result.availability !== 'OFFLINE') {
        setActionError(result.message || null);
      }
    } catch (caught) {
      if (caught instanceof SessionExpiredError) {
        await expireSession();
        return;
      }
      setActionError(errorMessage(caught, 'Going offline could not be confirmed. You may still appear available until your location expires.'));
    } finally {
      setWorking(false);
    }
  }

  return {
    snapshot,
    working,
    actionError: actionError ?? snapshot.notice,
    online,
    offline,
    turnOnLocation: () => riderLocationSharing.openLocationSettings(),
    allowLocation: () => riderLocationSharing.openAppSettings(),
  };
}
