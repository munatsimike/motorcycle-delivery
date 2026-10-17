import * as Location from 'expo-location';
import { Linking, Platform } from 'react-native';

import type { LocationPreparation } from '../domain/availabilityCommands';
import { readGpsFix, type GpsFix } from '../domain/gpsFix';
import { LOCATION_UPLOAD_INTERVAL_MS } from '../domain/locationUpload';
import type { LocationAccess } from '../domain/locationStatus';
import { RIDER_LOCATION_TASK } from '../domain/sharingPolicy';

const POSITION_TIMEOUT_MS = 12_000;

export const expoRiderLocation = {
  prepare,
  access,
  readCurrent,
  startUpdates,
  stopUpdates,
  openLocationSettings,
  openAppSettings,
};

async function prepare(): Promise<LocationPreparation> {
  const current = await access();
  if (current === 'services-off') {
    return { access: 'services-off', fix: null };
  }
  if (current === 'permission-blocked') {
    return { access: 'permission-blocked', fix: null };
  }
  if (current !== 'granted') {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== Location.PermissionStatus.GRANTED) {
      return {
        access: permission.canAskAgain ? 'permission-needed' : 'permission-blocked',
        fix: null,
      };
    }
  }
  const fix = await readCurrent();
  if (!fix) {
    return { access: 'position-unavailable', fix: null };
  }
  return { access: 'granted', fix };
}

async function access(): Promise<LocationAccess> {
  const enabled = await Location.hasServicesEnabledAsync();
  if (!enabled) {
    return 'services-off';
  }
  const permission = await Location.getForegroundPermissionsAsync();
  if (permission.status === Location.PermissionStatus.GRANTED) {
    return 'granted';
  }
  return permission.canAskAgain ? 'permission-needed' : 'permission-blocked';
}

async function readCurrent(): Promise<GpsFix | null> {
  try {
    const position = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      POSITION_TIMEOUT_MS,
    );
    return readGpsFix(position.coords.latitude, position.coords.longitude);
  } catch {
    return null;
  }
}

async function startUpdates(): Promise<void> {
  const started = await Location.hasStartedLocationUpdatesAsync(RIDER_LOCATION_TASK).catch(() => false);
  if (started) {
    return;
  }
  await Location.startLocationUpdatesAsync(RIDER_LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: LOCATION_UPLOAD_INTERVAL_MS,
    distanceInterval: 0,
    foregroundService: {
      notificationTitle: "You're online",
      notificationBody: 'Riders is sharing your location so customers nearby can find you.',
      notificationColor: '#169B62',
      killServiceOnDestroy: true,
    },
  });
}

async function stopUpdates(): Promise<void> {
  const started = await Location.hasStartedLocationUpdatesAsync(RIDER_LOCATION_TASK).catch(() => false);
  if (!started) {
    return;
  }
  await Location.stopLocationUpdatesAsync(RIDER_LOCATION_TASK);
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
        reject(error instanceof Error ? error : new Error('Location request failed.'));
      },
    );
  });
}
