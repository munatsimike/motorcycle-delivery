import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';

import { decideNotificationPermission } from '../domain/riderAvailabilityAlert';

export const RIDER_ALERT_CHANNEL_ID = 'rider-availability';

const DEVELOPMENT_BUILD_MESSAGE = 'Notifications need a Riders development build on this phone. They are not available in Expo Go.';

export type RiderAlertPermission =
  | { status: 'granted'; token: string }
  | { status: 'denied' }
  | { status: 'unavailable'; message: string };

export async function prepareRiderAlertPush(): Promise<RiderAlertPermission> {
  const current = await Notifications.getPermissionsAsync();
  const decision = decideNotificationPermission(current.status);
  if (decision === 'denied') {
    return { status: 'denied' };
  }
  if (decision === 'request') {
    const asked = await Notifications.requestPermissionsAsync();
    if (asked.status !== 'granted') {
      return { status: 'denied' };
    }
  }
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(RIDER_ALERT_CHANNEL_ID, {
      name: 'Rider availability',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const projectId = readExpoProjectId();
  if (!projectId) {
    return { status: 'unavailable', message: DEVELOPMENT_BUILD_MESSAGE };
  }
  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token.data) {
      return { status: 'unavailable', message: DEVELOPMENT_BUILD_MESSAGE };
    }
    return { status: 'granted', token: token.data };
  } catch {
    return { status: 'unavailable', message: DEVELOPMENT_BUILD_MESSAGE };
  }
}

export function openNotificationSettings(): Promise<void> {
  return Linking.openSettings();
}

function readExpoProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  const projectId = extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  return typeof projectId === 'string' && projectId.trim() ? projectId : null;
}
