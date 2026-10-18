import { useEffect, useState } from 'react';

import type { PlaceBias } from '../../data/CustomerDeliveryApiRepository';
import { expoCustomerLocation } from '../../../riders/data/expoCustomerLocation';

export function usePlaceBias(): PlaceBias | null {
  const [bias, setBias] = useState<PlaceBias | null>(null);

  useEffect(() => {
    let current = true;
    void expoCustomerLocation.read().then((location) => {
      if (!current || location.status !== 'ready') {
        return;
      }
      setBias({ latitude: location.latitude, longitude: location.longitude });
    }).catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);

  return bias;
}

export function selectedPlaceBias(latitude: string, longitude: string): PlaceBias | null {
  if (!latitude.trim() || !longitude.trim()) {
    return null;
  }
  const parsedLatitude = Number(latitude);
  const parsedLongitude = Number(longitude);
  if (
    !Number.isFinite(parsedLatitude)
    || !Number.isFinite(parsedLongitude)
    || Math.abs(parsedLatitude) < 0.000001
    || parsedLatitude < -90
    || parsedLatitude > 90
    || parsedLongitude < -180
    || parsedLongitude > 180
  ) {
    return null;
  }
  return { latitude: parsedLatitude, longitude: parsedLongitude };
}
