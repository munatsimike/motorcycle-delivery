import type { DeviceLocation } from './customerLocation';
import { needsAvailabilityRequest } from './customerLocation';
import { filterValidNearbyRiderPoints, type NearbyRiderMapPoint } from './nearbyRiderCount';

export type NearbyAvailability =
  | { status: 'loading' }
  | { status: 'services-off' }
  | { status: 'permission-denied'; canAskAgain: boolean }
  | { status: 'position-unavailable' }
  | { status: 'ready'; count: number; points: NearbyRiderMapPoint[] }
  | { status: 'check-failed'; message: string };

export async function resolveNearbyAvailability(
  location: DeviceLocation,
  fetchNearby: (latitude: number, longitude: number) => Promise<{ count: number; points: NearbyRiderMapPoint[] }>,
  failureMessage: (error: unknown) => string,
): Promise<NearbyAvailability> {
  if (!needsAvailabilityRequest(location)) {
    return location;
  }
  try {
    const nearby = await fetchNearby(location.latitude, location.longitude);
    const points = filterValidNearbyRiderPoints(nearby.points);
    return { status: 'ready', count: points.length, points };
  } catch (error) {
    return { status: 'check-failed', message: failureMessage(error) };
  }
}
