import { useCallback, useEffect, useRef, useState } from 'react';

import { errorMessage } from '../../../auth/presentation/errorMessage';
import { riderAvailabilityAlertRepository } from '../../data/RiderAvailabilityAlertApiRepository';
import { openNotificationSettings, prepareRiderAlertPush } from '../../data/riderAlertNotifications';
import type { RiderAlertPhase } from '../../domain/nearbyCard';
import type { NearbyAvailability } from '../../domain/nearbyAvailability';

type NearbyPoint = {
  latitude: number;
  longitude: number;
};

export function useRiderAvailabilityAlert(
  accessToken: string | null,
  nearby: NearbyAvailability,
  point: NearbyPoint | null,
  revision: number,
  onRidersAvailable: () => void,
) {
  const [phase, setPhase] = useState<RiderAlertPhase>('checking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const responseId = useRef(0);
  const watching = nearby.status === 'ready' && nearby.count === 0;

  useEffect(() => {
    if (!accessToken || !watching) {
      return;
    }
    const current = responseId.current + 1;
    responseId.current = current;
    void riderAvailabilityAlertRepository.current(accessToken)
      .then((alert) => {
        if (responseId.current === current) {
          setPhase(alert ? 'active' : 'off');
        }
      })
      .catch(() => {
        if (responseId.current === current) {
          setPhase((currentPhase) => (currentPhase === 'checking' ? 'off' : currentPhase));
        }
      });
  }, [accessToken, revision, watching]);

  const confirmPhase = useCallback((next: RiderAlertPhase) => {
    responseId.current += 1;
    setPhase(next);
  }, []);

  const enable = useCallback(async () => {
    if (busy || !accessToken || !watching || !point) {
      return;
    }
    if (phase === 'denied') {
      await openNotificationSettings();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const permission = await prepareRiderAlertPush();
      if (permission.status === 'denied') {
        confirmPhase('denied');
        return;
      }
      if (permission.status === 'unavailable') {
        setError(permission.message);
        return;
      }
      const result = await riderAvailabilityAlertRepository.create(accessToken, {
        latitude: point.latitude,
        longitude: point.longitude,
        expoPushToken: permission.token,
      });
      if (result.result === 'riders-available') {
        confirmPhase('off');
        onRidersAvailable();
        return;
      }
      confirmPhase('active');
    } catch (failure) {
      setError(errorMessage(failure, 'Notifications could not be enabled. Try again.'));
    } finally {
      setBusy(false);
    }
  }, [accessToken, busy, confirmPhase, onRidersAvailable, phase, point, watching]);

  const cancel = useCallback(async () => {
    if (busy || !accessToken) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await riderAvailabilityAlertRepository.cancel(accessToken);
      confirmPhase('off');
    } catch (failure) {
      setError(errorMessage(failure, 'The alert could not be cancelled. Try again.'));
    } finally {
      setBusy(false);
    }
  }, [accessToken, busy, confirmPhase]);

  return {
    phase: watching ? phase : 'off',
    busy,
    error: watching ? error : null,
    enable,
    cancel,
    openSettings: openNotificationSettings,
  };
}
