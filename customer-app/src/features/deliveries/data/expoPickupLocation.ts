import * as Location from 'expo-location';

import { formatReverseAddress, type PickupFix, type PickupPermission } from '../domain/pickupLocation';

const POSITION_TIMEOUT_MS = 12_000;

export type PickupLocationPort = {
  servicesEnabled(): Promise<boolean>;
  permission(): Promise<PickupPermission>;
  requestPermission(): Promise<PickupPermission>;
  readFix(): Promise<PickupFix | 'timeout' | 'invalid'>;
  reverseGeocode(latitude: number, longitude: number): Promise<string | null>;
};

export const expoPickupLocation: PickupLocationPort = {
  async servicesEnabled() {
    return Location.hasServicesEnabledAsync();
  },
  async permission() {
    return classifyPermission(await Location.getForegroundPermissionsAsync());
  },
  async requestPermission() {
    return classifyPermission(await Location.requestForegroundPermissionsAsync());
  },
  readFix,
  async reverseGeocode(latitude, longitude) {
    try {
      const matches = await Location.reverseGeocodeAsync({ latitude, longitude });
      return formatReverseAddress(matches[0] ?? null);
    } catch {
      return null;
    }
  },
};

async function readFix(): Promise<PickupFix | 'timeout' | 'invalid'> {
  try {
    const position = await withTimeout(
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        mayShowUserSettingsDialog: false,
      }),
      POSITION_TIMEOUT_MS,
    );
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyMetres: position.coords.accuracy,
      capturedAt: position.timestamp,
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'Location request timed out.') {
      return 'timeout';
    }
    return 'invalid';
  }
}

function classifyPermission(permission: Location.LocationPermissionResponse): PickupPermission {
  if (permission.status === Location.PermissionStatus.GRANTED) {
    return 'granted';
  }
  return permission.canAskAgain ? 'denied' : 'blocked';
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Location request timed out.')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
