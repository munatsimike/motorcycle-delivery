import type { DeviceLocation } from './customerLocation';
import { needsAvailabilityRequest } from './customerLocation';

export type NearbyAvailability =
  | { status: 'loading' }
  | { status: 'services-off' }
  | { status: 'permission-denied'; canAskAgain: boolean }
  | { status: 'position-unavailable' }
  | { status: 'ready'; count: number }
  | { status: 'check-failed'; message: string };

export async function resolveNearbyAvailability(
  location: DeviceLocation,
  fetchCount: (latitude: number, longitude: number) => Promise<number>,
  failureMessage: (error: unknown) => string,
): Promise<NearbyAvailability> {
  if (!needsAvailabilityRequest(location)) {
    return location;
  }
  try {
    const count = await fetchCount(location.latitude, location.longitude);
    return { status: 'ready', count };
  } catch (error) {
    return { status: 'check-failed', message: failureMessage(error) };
  }
}
