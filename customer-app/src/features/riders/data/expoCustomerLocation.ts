import * as Location from 'expo-location';
import { Linking, Platform } from 'react-native';

import type { CustomerLocationPort, DeviceLocation } from '../domain/customerLocation';

const POSITION_TIMEOUT_MS = 12_000;

export const expoCustomerLocation: CustomerLocationPort = {
  read,
  requestPermission,
  openLocationSettings,
  openAppSettings,
};

async function read(): Promise<DeviceLocation> {
  const enabled = await Location.hasServicesEnabledAsync();
  if (!enabled) {
    return { status: 'services-off' };
  }
  const permission = await Location.getForegroundPermissionsAsync();
  if (permission.status !== Location.PermissionStatus.GRANTED) {
    return { status: 'permission-denied', canAskAgain: permission.canAskAgain };
  }
  return readPosition();
}

async function requestPermission(): Promise<DeviceLocation> {
  const enabled = await Location.hasServicesEnabledAsync();
  if (!enabled) {
    return { status: 'services-off' };
  }
  const current = await Location.getForegroundPermissionsAsync();
  if (current.status !== Location.PermissionStatus.GRANTED && !current.canAskAgain && current.status === Location.PermissionStatus.DENIED) {
    return { status: 'permission-denied', canAskAgain: false };
  }
  const permission = current.status === Location.PermissionStatus.GRANTED
    ? current
    : await Location.requestForegroundPermissionsAsync();
  if (permission.status !== Location.PermissionStatus.GRANTED) {
    return { status: 'permission-denied', canAskAgain: permission.canAskAgain };
  }
  return readPosition();
}

async function readPosition(): Promise<DeviceLocation> {
  try {
    const position = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      POSITION_TIMEOUT_MS,
    );
    const { latitude, longitude } = position.coords;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return { status: 'position-unavailable' };
    }
    return { status: 'ready', latitude, longitude };
  } catch {
    return { status: 'position-unavailable' };
  }
}

async function openLocationSettings(): Promise<void> {
  if (Platform.OS === 'android') {
    try {
      await Location.enableNetworkProviderAsync();
      return;
    } catch {
      await Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS');
      return;
    }
  }
  await Linking.openSettings();
}

async function openAppSettings(): Promise<void> {
  await Linking.openSettings();
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
