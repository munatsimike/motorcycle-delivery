import { describe, expect, it, vi } from 'vitest';

const setNotificationHandler = vi.fn();
const scheduleNotificationAsync = vi.fn();

vi.mock('expo-notifications', () => ({
  setNotificationHandler: (...args: unknown[]) => setNotificationHandler(...args),
  scheduleNotificationAsync: (...args: unknown[]) => scheduleNotificationAsync(...args),
  getPermissionsAsync: vi.fn(async () => ({ status: 'granted', granted: true, canAskAgain: false })),
  requestPermissionsAsync: vi.fn(),
  setNotificationChannelAsync: vi.fn(),
  getExpoPushTokenAsync: vi.fn(),
  addNotificationResponseReceivedListener: vi.fn(() => ({ remove: vi.fn() })),
  getLastNotificationResponseAsync: vi.fn(async () => null),
  addPushTokenListener: vi.fn(() => ({ remove: vi.fn() })),
  getDevicePushTokenAsync: vi.fn(),
  AndroidImportance: { HIGH: 4 },
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

vi.mock('expo-constants', () => ({
  default: { expoConfig: null, easConfig: null },
}));

vi.mock('react-native', () => ({
  Linking: { openSettings: vi.fn() },
  Platform: { OS: 'android' },
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));

vi.mock('../../../navigation/navigationRef', () => ({
  navigationRef: { isReady: () => true, navigate: vi.fn() },
  openHomeForRiderAlert: vi.fn(() => true),
  flushRiderAlertNavigation: vi.fn(),
}));

vi.mock('@react-navigation/native', () => ({
  createNavigationContainerRef: () => ({ isReady: () => true, navigate: vi.fn() }),
}));

import { foregroundNotificationBehavior } from './customerPush';
import {
  createCustomerNotificationPresentation,
  installCustomerNotificationHandler,
} from './customerNotificationPresentation';

describe('customer notification presentation', () => {
  it('installs one foreground handler and ignores a later install', async () => {
    const host = { setNotificationHandler: vi.fn() };
    const presentation = createCustomerNotificationPresentation(host);
    presentation.install();
    presentation.install();
    expect(presentation.installed()).toBe(true);
    expect(host.setNotificationHandler).toHaveBeenCalledTimes(1);
    const handler = host.setNotificationHandler.mock.calls[0]?.[0] as {
      handleNotification: () => Promise<ReturnType<typeof foregroundNotificationBehavior>>;
    };
    expect(await handler.handleNotification()).toEqual(foregroundNotificationBehavior());
    expect(foregroundNotificationBehavior()).toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });
  });

  it('keeps the app handler when rider alert screens are imported', async () => {
    await import('../../riders/data/riderAlertNotifications');
    await import('../../riders/presentation/viewmodels/useRiderAvailabilityAlert');
    await import('../../riders/presentation/viewmodels/useRiderAlertNotificationNavigation');
    await import('../presentation/useCustomerPush');
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(setNotificationHandler).toHaveBeenCalledTimes(1);
    const handler = setNotificationHandler.mock.calls[0]?.[0] as {
      handleNotification: () => Promise<ReturnType<typeof foregroundNotificationBehavior>>;
    };
    expect(await handler.handleNotification()).toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });
    installCustomerNotificationHandler({ setNotificationHandler: vi.fn() });
    expect(setNotificationHandler).toHaveBeenCalledTimes(1);
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});
