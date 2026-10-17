import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { errorMessage } from '../../../auth/presentation/errorMessage';
import { expoCustomerLocation } from '../../data/expoCustomerLocation';
import { nearbyRiderRepository } from '../../data/NearbyRiderApiRepository';
import type { DeviceLocation } from '../../domain/customerLocation';
import { resolveNearbyAvailability, type NearbyAvailability } from '../../domain/nearbyAvailability';
import { loadNearbyRiderCount } from '../../domain/usecases/loadNearbyRiderCount';

export type NearbyPoint = {
  latitude: number;
  longitude: number;
};

export function useNearbyRiders(accessToken: string | null) {
  const [state, setState] = useState<NearbyAvailability>({ status: 'loading' });
  const [point, setPoint] = useState<NearbyPoint | null>(null);
  const [revision, setRevision] = useState(0);
  const request = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const apply = useCallback(async (location: DeviceLocation) => {
    const current = request.current + 1;
    request.current = current;
    const availability = await resolveNearbyAvailability(
      location,
      (latitude, longitude) => {
        if (!accessToken) {
          throw new Error('Rider availability is unavailable.');
        }
        return loadNearbyRiderCount(nearbyRiderRepository, accessToken, latitude, longitude);
      },
      (error) => errorMessage(error, 'Check your connection and try again.'),
    );
    if (request.current === current) {
      setState(availability);
      setPoint(location.status === 'ready'
        ? { latitude: location.latitude, longitude: location.longitude }
        : null);
      setRevision((value) => value + 1);
    }
  }, [accessToken]);

  const refresh = useCallback(async () => {
    const location = await expoCustomerLocation.read();
    await apply(location);
  }, [apply]);

  useFocusEffect(useCallback(() => {
    void refresh();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void refresh();
      }
    });
    return () => subscription.remove();
  }, [refresh]));

  const turnOnLocation = useCallback(async () => {
    await expoCustomerLocation.openLocationSettings();
    await refresh();
  }, [refresh]);

  const allowLocation = useCallback(async () => {
    const current = stateRef.current;
    if (current.status === 'permission-denied' && !current.canAskAgain) {
      await expoCustomerLocation.openAppSettings();
      return;
    }
    await apply(await expoCustomerLocation.requestPermission());
  }, [apply]);

  return {
    state,
    point,
    revision,
    turnOnLocation,
    allowLocation,
    tryAgain: refresh,
  };
}
