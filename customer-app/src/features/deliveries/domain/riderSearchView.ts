import type { DeliveryStatus } from './deliveryStatus';

export type RiderSearchView = 'loading' | 'searching' | 'assigned' | 'no-rider' | 'offline' | 'details';

export function isConnectionError(message: string): boolean {
  return /network request failed|timed out|connection/i.test(message);
}

export function riderSearchView(input: {
  hasDelivery: boolean;
  isLoading: boolean;
  status: DeliveryStatus | null;
  error: string | null;
}): RiderSearchView {
  if (!input.hasDelivery && input.isLoading) {
    return 'loading';
  }
  if (!input.hasDelivery) {
    return 'offline';
  }
  if (input.error && isConnectionError(input.error)) {
    return 'offline';
  }
  if (input.status === 'SEARCHING') {
    return 'searching';
  }
  if (input.status === 'ASSIGNED') {
    return 'assigned';
  }
  if (input.status === 'NO_RIDER_FOUND') {
    return 'no-rider';
  }
  return 'details';
}
