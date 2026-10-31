import { GPS_FRESH_MS } from './dispatch.constants.js';
import { straightLineMetres } from './straight-line.js';

export const CUSTOMER_OFFER_LOCATION_FRESH_MS = GPS_FRESH_MS;

export function pickupDistanceMeters(
  pickupLatitude: unknown,
  pickupLongitude: unknown,
  location: { latitude: unknown; longitude: unknown; updatedAt: Date } | null,
  now: Date,
): number | null {
  if (!location || now.getTime() - location.updatedAt.getTime() > CUSTOMER_OFFER_LOCATION_FRESH_MS) {
    return null;
  }
  const pickupLat = readCoordinate(pickupLatitude);
  const pickupLng = readCoordinate(pickupLongitude);
  const riderLat = readCoordinate(location.latitude);
  const riderLng = readCoordinate(location.longitude);
  if (pickupLat === null || pickupLng === null || riderLat === null || riderLng === null) {
    return null;
  }
  return straightLineMetres(riderLat, riderLng, pickupLat, pickupLng);
}

function readCoordinate(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(number)) {
    return null;
  }
  return number;
}
