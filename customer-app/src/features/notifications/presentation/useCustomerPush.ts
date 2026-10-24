import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

import { navigationRef } from '../../../navigation/navigationRef';
import { registerCustomerPushDevice } from '../data/customerPushApi';
import { pushRegistrationStore } from '../data/pushRegistrationStore';
import { customerPushSetupDiagnostic, fcmTokenFromDevice, fcmTokenWhenPermitted, readCustomerPush, trackingParams, type DevicePushToken, DELIVERY_CHANNEL_ID } from '../domain/customerPush';
import { installCustomerNotificationHandler } from '../domain/customerNotificationPresentation';
import { createPushInteractions } from '../domain/customerPushNavigation';
import { syncPushRegistration } from '../domain/customerPushRegistration';

const interactions = createPushInteractions();
let sessionReady = false;

installCustomerNotificationHandler(Notifications);

export function publishCustomerPush(): void {
  const launch = interactions.take(sessionReady, navigationRef.isReady());
  if (!launch) {
    return;
  }
  navigationRef.navigate('DeliveryTracking', trackingParams(launch.push));
}

export function openCustomerPushResponse(response: Notifications.NotificationResponse | null): void {
  if (!response) {
    return;
  }
  interactions.accept(
    response.notification.request.identifier,
    readCustomerPush(response.notification.request.content.data),
  );
  publishCustomerPush();
}

export function setCustomerPushSessionReady(ready: boolean): void {
  sessionReady = ready;
  publishCustomerPush();
}

export function useCustomerPush(signedIn: boolean, accessToken: string | null, customerId: string | null): void {
  useEffect(() => {
    setCustomerPushSessionReady(signedIn);
  }, [signedIn]);

  useEffect(() => {
    const responses = Notifications.addNotificationResponseReceivedListener((response) => {
      openCustomerPushResponse(response);
    });
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      openCustomerPushResponse(response);
    });
    return () => responses.remove();
  }, []);

  useEffect(() => {
    if (!signedIn || !accessToken || !customerId) {
      return;
    }
    let active = true;
    let unavailable = false;
    const registerToken = async (token: string | null) => {
      if (!active || !token || unavailable) {
        return;
      }
      const outcome = await syncPushRegistration({
        accessToken,
        customerId,
        token,
        store: pushRegistrationStore,
        register: registerCustomerPushDevice,
      });
      if (outcome === 'unavailable') {
        unavailable = true;
      }
    };
    void (async () => {
      await ensureDeliveryChannel();
      await registerToken(await readFcmDeviceToken());
    })();
    const tokens = Notifications.addPushTokenListener((token) => {
      void registerToken(fcmTokenFromDevice(deviceToken(token)));
    });
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void readFcmDeviceToken().then((token) => registerToken(token));
      }
    });
    return () => {
      active = false;
      tokens.remove();
      appState.remove();
    };
  }, [signedIn, accessToken, customerId]);
}

async function readFcmDeviceToken(): Promise<string | null> {
  try {
    const current = await Notifications.getPermissionsAsync();
    let granted = current.granted;
    if (!granted && current.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) {
      warnPushSetup(customerPushSetupDiagnostic({
        executionEnvironment: executionEnvironment(),
        permissionGranted: false,
        tokenAccepted: false,
      }));
      return null;
    }
    const device = deviceToken(await Notifications.getDevicePushTokenAsync());
    const token = fcmTokenWhenPermitted(true, device);
    warnPushSetup(customerPushSetupDiagnostic({
      executionEnvironment: executionEnvironment(),
      permissionGranted: true,
      tokenAccepted: token !== null,
    }));
    return token;
  } catch {
    warnPushSetup(customerPushSetupDiagnostic({
      executionEnvironment: executionEnvironment(),
      permissionGranted: true,
      tokenAccepted: false,
    }));
    return null;
  }
}

function executionEnvironment(): string | null {
  return typeof Constants.executionEnvironment === 'string' ? Constants.executionEnvironment : null;
}

function warnPushSetup(diagnostic: string | null): void {
  const dev = (globalThis as { __DEV__?: boolean }).__DEV__ === true;
  if (diagnostic && dev) {
    console.warn(diagnostic);
  }
}

function deviceToken(token: Notifications.DevicePushToken): DevicePushToken {
  return { type: token.type, data: token.data };
}

async function ensureDeliveryChannel(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  await Notifications.setNotificationChannelAsync(DELIVERY_CHANNEL_ID, {
    name: 'Delivery updates',
    importance: Notifications.AndroidImportance.HIGH,
  });
}
