import { createNavigationContainerRef } from '@react-navigation/native';

import { riderAlertHomeTarget } from '../features/riders/domain/riderAlertNotification';
import type { RootStackParamList } from './types';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

let pendingRefreshAt: number | null = null;

export function openHomeForRiderAlert(nearbyRefreshAt = Date.now()): boolean {
  if (!navigationRef.isReady()) {
    pendingRefreshAt = nearbyRefreshAt;
    return false;
  }
  pendingRefreshAt = null;
  const target = riderAlertHomeTarget(nearbyRefreshAt);
  navigationRef.navigate(target.name, target.params);
  return true;
}

export function flushRiderAlertNavigation(): void {
  if (pendingRefreshAt == null || !navigationRef.isReady()) {
    return;
  }
  const nearbyRefreshAt = pendingRefreshAt;
  pendingRefreshAt = null;
  const target = riderAlertHomeTarget(nearbyRefreshAt);
  navigationRef.navigate(target.name, target.params);
}
