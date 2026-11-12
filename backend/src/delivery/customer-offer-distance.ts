import { GPS_FRESH_MS } from './dispatch.constants.js';
import { straightLineMetres } from './straight-line.js';

export const CUSTOMER_OFFER_LOCATION_FRESH_MS = GPS_FRESH_MS;

export type FreshPickupCoords = {
  pickupLatitude: number;
  pickupLongitude: number;
  riderLatitude: number;
  riderLongitude: number;
};

/** Last stored rider fix. Age does not matter; the offers map must not wait for a new upload. */
export function knownRiderPoint(
  location: { latitude: unknown; longitude: unknown } | null,
): { latitude: number; longitude: number } | null {
  if (!location) {
    return null;
  }
  const latitude = readCoordinate(location.latitude);
  const longitude = readCoordinate(location.longitude);
  if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return null;
  }
  return { latitude, longitude };
}

export function freshPickupCoords(
  pickupLatitude: unknown,
  pickupLongitude: unknown,
  location: { latitude: unknown; longitude: unknown; updatedAt: Date } | null,
  now: Date,
): FreshPickupCoords | null {
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
  return {
    pickupLatitude: pickupLat,
    pickupLongitude: pickupLng,
    riderLatitude: riderLat,
    riderLongitude: riderLng,
  };
}

export function pickupDistanceMeters(
  pickupLatitude: unknown,
  pickupLongitude: unknown,
  location: { latitude: unknown; longitude: unknown; updatedAt: Date } | null,
  now: Date,
): number | null {
  const point = freshPickupCoords(pickupLatitude, pickupLongitude, location, now);
  if (!point) {
    return null;
  }
  return straightLineMetres(point.riderLatitude, point.riderLongitude, point.pickupLatitude, point.pickupLongitude);
}

function readCoordinate(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(number)) {
    return null;
  }
  return number;
}
