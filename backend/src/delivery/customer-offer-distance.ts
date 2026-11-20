import { RiderAvailability } from '../generated/prisma/client.js';
import { GPS_FRESH_MS } from './dispatch.constants.js';
import { straightLineMetres } from './straight-line.js';

export const CUSTOMER_OFFER_LOCATION_FRESH_MS = GPS_FRESH_MS;

export type FreshPickupCoords = {
  pickupLatitude: number;
  pickupLongitude: number;
  riderLatitude: number;
  riderLongitude: number;
};

/**
 * Offers-map marker. Only a rider who is available, receiving requests, and
 * has a GPS fix younger than 60 seconds. The bid itself stays either way.
 */
export function knownRiderPoint(
  location: { latitude: unknown; longitude: unknown; updatedAt?: Date | null } | null,
  now: Date,
  rider: { availability: RiderAvailability | string; receivingRequests: boolean | null },
): { latitude: number; longitude: number } | null {
  if (!location || rider.availability !== RiderAvailability.AVAILABLE || rider.receivingRequests !== true) {
    return null;
  }
  const updatedAt = location.updatedAt;
  if (!(updatedAt instanceof Date) || Number.isNaN(updatedAt.getTime())) {
    return null;
  }
  if (!(updatedAt.getTime() > now.getTime() - CUSTOMER_OFFER_LOCATION_FRESH_MS)) {
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
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  if (isDecimal(value)) {
    const number = Number(value.toFixed(7));
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function isDecimal(value: unknown): value is { toFixed(digits: number): string } {
  return typeof value === 'object' && value !== null && 'toFixed' in value && typeof value.toFixed === 'function';
}
