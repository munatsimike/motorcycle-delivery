import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { errorMessage } from '../../../auth/presentation/errorMessage';
import { expoCustomerLocation } from '../../data/expoCustomerLocation';
import { nearbyRiderRepository } from '../../data/NearbyRiderApiRepository';
import type { DeviceLocation } from '../../domain/customerLocation';
import { resolveNearbyAvailability, type NearbyAvailability } from '../../domain/nearbyAvailability';
import { nextNearbyMarkers, type NearbyMarker } from '../../domain/nearbyMarkers';
import { isNearbyRiderPointExpired, filterValidNearbyRiderPoints } from '../../domain/nearbyRiderCount';
import { loadNearbyRiders } from '../../domain/usecases/loadNearbyRiderCount';

export type NearbyPoint = {
  latitude: number;
  longitude: number;
};

export function useNearbyRiders(accessToken: string | null) {
  const [state, setState] = useState<NearbyAvailability>({ status: 'loading' });
  const [point, setPoint] = useState<NearbyPoint | null>(null);
  const [points, setPoints] = useState<readonly NearbyMarker[]>([]);
  const [revision, setRevision] = useState(0);
  const request = useRef(0);
  const refreshInFlight = useRef(false);
  const markerIds = useRef(0);
  const focused = useRef(false);
  const pointsRef = useRef<readonly NearbyMarker[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;

  const apply = useCallback(async (location: DeviceLocation) => {
    const current = ++request.current;
    const availability = await resolveNearbyAvailability(
      location,
      async (latitude, longitude) => {
        if (!accessToken) {
          throw new Error('Rider availability is unavailable.');
        }
        const nearby = await loadNearbyRiders(nearbyRiderRepository, accessToken, latitude, longitude);
        const points = filterValidNearbyRiderPoints(nearby.points);
        return {
          count: points.length,
          points,
        };
      },
      (error) => errorMessage(error, 'Check your connection and try again.'),
    );
    if (request.current === current) {
      const shown = nextNearbyMarkers(
        pointsRef.current,
        availability.status === 'ready'
          ? { status: 'ready', points: availability.points }
          : { status: 'failed' },
        () => `nearby-marker-${markerIds.current += 1}`,
      );
      pointsRef.current = shown;
      setState(availability.status === 'ready'
        ? { status: 'ready', count: shown.length, points: [...shown] }
        : availability);
      setPoint(location.status === 'ready'
        ? { latitude: location.latitude, longitude: location.longitude }
        : null);
      setPoints(shown);
      setRevision((value) => value + 1);
    }
  }, [accessToken]);

  useEffect(() => {
    if (points.length === 0) {
      return undefined;
    }
    const pruneExpired = () => {
      setPoints((current) => {
        const nextPoints = current.filter((point) => !isNearbyRiderPointExpired(point));
        pointsRef.current = nextPoints;
        if (nextPoints.length === current.length) return current;
        setState((currentState) => (
          currentState.status === 'ready'
            ? { status: 'ready', count: nextPoints.length, points: nextPoints }
            : currentState
        ));
        setRevision((value) => value + 1);
        return nextPoints;
      });
    };
    const timer = setInterval(pruneExpired, 5_000);
    return () => clearInterval(timer);
  }, [points]);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    const current = ++request.current;
    try {
      const location = await expoCustomerLocation.read();
      if (request.current === current) await apply(location);
    } finally {
      refreshInFlight.current = false;
    }
  }, [apply]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    void refresh();
    const timer = setInterval(() => {
      if (focused.current) {
        void refresh();
      }
    }, 20_000);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && focused.current) {
        void refresh();
      }
    });
    return () => {
      focused.current = false;
      ++request.current;
      clearInterval(timer);
      subscription.remove();
    };
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
    points,
    revision,
    turnOnLocation,
    allowLocation,
    tryAgain: refresh,
  };
}
