import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { ApiError } from '../../../../services/api/apiClient';
import { errorMessage } from '../../../auth/presentation/errorMessage';
import { customerDeliveryRepository } from '../../data/CustomerDeliveryApiRepository';
import { createDeliveryTracker, type TrackingClock, type TrackingSnapshot } from '../../domain/deliveryTracking';
import { loadCustomerDelivery } from '../../domain/usecases/loadCustomerDelivery';

const EMPTY: TrackingSnapshot = {
  delivery: null,
  error: null,
  isLoading: true,
};

export function useDeliveryTracking(accessToken: string | null, deliveryId: string) {
  const [snapshot, setSnapshot] = useState<TrackingSnapshot>(EMPTY);
  const trackerRef = useRef<ReturnType<typeof createDeliveryTracker> | null>(null);

  useEffect(() => {
    const tracker = createDeliveryTracker({
      load: () => loadCustomerDelivery(customerDeliveryRepository, accessToken, deliveryId),
      clock: timeoutClock(),
      appActive: AppState.currentState === 'active',
      isAuthError: (error) => error instanceof ApiError && (error.status === 401 || error.status === 403),
      errorText: (error) => errorMessage(error, 'Delivery details are unavailable.'),
      onChange: setSnapshot,
    });
    trackerRef.current = tracker;
    return () => {
      tracker.stop();
      if (trackerRef.current === tracker) {
        trackerRef.current = null;
      }
    };
  }, [accessToken, deliveryId]);

  useFocusEffect(useCallback(() => {
    trackerRef.current?.setFocused(true);
    return () => {
      trackerRef.current?.setFocused(false);
    };
  }, [accessToken, deliveryId]));

  useEffect(() => {
    trackerRef.current?.setAppActive(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', (state) => {
      trackerRef.current?.setAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, [accessToken, deliveryId]);

  const reload = useCallback(() => {
    trackerRef.current?.refresh();
  }, []);

  return {
    delivery: snapshot.delivery,
    isLoading: snapshot.isLoading,
    error: snapshot.error,
    reload,
  };
}

function timeoutClock(): TrackingClock {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule(callback, delayMs) {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(callback, delayMs);
    },
    clear() {
      if (timer) {
        clearTimeout(timer);
      }
      timer = null;
    },
  };
}
