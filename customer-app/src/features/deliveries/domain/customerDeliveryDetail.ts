import { isKnownDeliveryStatus, type DeliveryStatus } from './deliveryStatus';

export type CustomerDeliveryDetail = {
  id: string;
  status: DeliveryStatus;
  currency: string;
  offeredPrice: string;
  suggestedPrice: string;
  distanceMeters: number;
  pickupAddress: string;
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  dropoffAddress: string;
  dropoffLatitude: number | null;
  dropoffLongitude: number | null;
  parcelDescription: string;
  createdAt: string | null;
};

export function readCustomerDeliveryDetail(value: unknown): CustomerDeliveryDetail {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) {
    throw new Error('Delivery details are unavailable.');
  }
  if (typeof value.status !== 'string' || !isKnownDeliveryStatus(value.status)) {
    throw new Error('Delivery details are unavailable.');
  }
  if (!isRecord(value.pickup) || !isRecord(value.dropoff) || !isRecord(value.parcel)) {
    throw new Error('Delivery details are unavailable.');
  }
  const pickupAddress = text(value.pickup.address);
  const pickupPoint = coordinatePair(value.pickup.latitude, value.pickup.longitude);
  const dropoffAddress = text(value.dropoff.address);
  const dropoffPoint = coordinatePair(value.dropoff.latitude, value.dropoff.longitude);
  const parcelDescription = text(value.parcel.description);
  const offeredPrice = text(value.offeredPrice);
  const suggestedPrice = text(value.suggestedPrice);
  const currency = text(value.currency);
  if (
    !pickupAddress
    || !dropoffAddress
    || !parcelDescription
    || !offeredPrice
    || !suggestedPrice
    || !currency
    || typeof value.distanceMeters !== 'number'
    || !Number.isFinite(value.distanceMeters)
  ) {
    throw new Error('Delivery details are unavailable.');
  }
  return {
    id: value.id,
    status: value.status,
    currency,
    offeredPrice,
    suggestedPrice,
    distanceMeters: value.distanceMeters,
    pickupAddress,
    pickupLatitude: pickupPoint.latitude,
    pickupLongitude: pickupPoint.longitude,
    dropoffAddress,
    dropoffLatitude: dropoffPoint.latitude,
    dropoffLongitude: dropoffPoint.longitude,
    parcelDescription,
    createdAt: typeof value.createdAt === 'string' && value.createdAt.trim() ? value.createdAt : null,
  };
}

function coordinatePair(latitude: unknown, longitude: unknown): { latitude: number | null; longitude: number | null } {
  const parsedLatitude = coordinate(latitude, 90);
  const parsedLongitude = coordinate(longitude, 180);
  if (parsedLatitude === null || parsedLongitude === null) {
    return { latitude: null, longitude: null };
  }
  return { latitude: parsedLatitude, longitude: parsedLongitude };
}

export function deliveryHasMapCoordinates(delivery: CustomerDeliveryDetail): boolean {
  return delivery.pickupLatitude !== null
    && delivery.pickupLongitude !== null
    && delivery.dropoffLatitude !== null
    && delivery.dropoffLongitude !== null;
}

function coordinate(value: unknown, limit: number): number | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric) || numeric < -limit || numeric > limit) {
    return null;
  }
  return numeric;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
