export const RIDER_AVAILABILITY_NOTIFICATION = 'rider-availability';

export function isRiderAvailabilityNotification(data: unknown): boolean {
  if (!data || typeof data !== 'object') {
    return false;
  }
  return (data as { kind?: unknown }).kind === RIDER_AVAILABILITY_NOTIFICATION;
}

export function riderAlertHomeTarget(nearbyRefreshAt: number) {
  return {
    name: 'CustomerHome' as const,
    params: {
      screen: 'Dashboard' as const,
      params: { nearbyRefreshAt },
    },
  };
}
