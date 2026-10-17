import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';

import { openHomeForRiderAlert } from '../../../../navigation/navigationRef';
import { isRiderAvailabilityNotification } from '../../domain/riderAlertNotification';

const openedResponses = new Set<string>();

export function useRiderAlertNotificationNavigation(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      openRiderAvailabilityNotification(response);
    });
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      openRiderAvailabilityNotification(response);
    });
    return () => subscription.remove();
  }, [enabled]);
}

function openRiderAvailabilityNotification(response: Notifications.NotificationResponse | null): void {
  if (!response || !isRiderAvailabilityNotification(response.notification.request.content.data)) {
    return;
  }
  const id = response.notification.request.identifier;
  if (!id || openedResponses.has(id)) {
    return;
  }
  if (!openHomeForRiderAlert()) {
    return;
  }
  openedResponses.add(id);
}
