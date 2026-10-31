import { isKnownDeliveryStatus, type DeliveryStatus } from './deliveryStatus';
import { readAssignedRider, type AssignedRider } from './trackingJourney';

export type ServiceClass = 'EXPRESS' | 'FLEXIBLE';

export type RiderPoint = {
  latitude: number;
  longitude: number;
  updatedAt: string | null;
};

export type RoutePoint = {
  latitude: number;
  longitude: number;
};

export type PickupApproach = {
  metres: number;
  seconds: number;
  line: RoutePoint[];
};

const VISIBLE_RIDER_LOCATION_STATUSES = new Set<DeliveryStatus>(['RIDER_ASSIGNED', 'COLLECTING']);

export function keepsRiderLocation(status: DeliveryStatus): boolean {
  return VISIBLE_RIDER_LOCATION_STATUSES.has(status);
}

export type CustomerDeliveryDetail = {
  id: string;
  status: DeliveryStatus;
  currency: string;
  offeredPrice: string | null;
  suggestedPrice: string;
  customerOffer?: string | null;
  serviceClass: ServiceClass | null;
  deliverBy: string | null;
  distanceMeters: number;
  pickupAddress: string;
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  dropoffAddress: string;
  dropoffLatitude: number | null;
  dropoffLongitude: number | null;
  parcelDescription: string;
  createdAt: string | null;
  riderLocation: RiderPoint | null;
  pickupApproach: PickupApproach | null;
  rider: AssignedRider | null;
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
  const offeredPrice = moneyOrNull(value.offeredPrice);
  const suggestedPrice = text(value.suggestedPrice);
  const currency = text(value.currency);
  const serviceClass = readServiceClass(value.serviceClass);
  const deliverBy = readDeadline(value.deliverBy);
  if (
    !pickupAddress
    || !dropoffAddress
    || !parcelDescription
    || offeredPrice === undefined
    || !suggestedPrice
    || !currency
    || serviceClass === undefined
    || deliverBy === undefined
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
    customerOffer: moneyOrNull(value.customerOffer) ?? null,
    serviceClass,
    deliverBy,
    distanceMeters: value.distanceMeters,
    pickupAddress,
    pickupLatitude: pickupPoint.latitude,
    pickupLongitude: pickupPoint.longitude,
    dropoffAddress,
    dropoffLatitude: dropoffPoint.latitude,
    dropoffLongitude: dropoffPoint.longitude,
    parcelDescription,
    createdAt: typeof value.createdAt === 'string' && value.createdAt.trim() ? value.createdAt : null,
    riderLocation: keepsRiderLocation(value.status) ? readRiderPoint(value.riderLocation) : null,
    pickupApproach: keepsRiderLocation(value.status) ? readPickupApproach(value.pickupApproach) : null,
    rider: readAssignedRider(value.rider),
  };
}

function readServiceClass(value: unknown): ServiceClass | null | undefined {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (value === 'EXPRESS' || value === 'FLEXIBLE') {
    return value;
  }
  return undefined;
}

function readDeadline(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
    return undefined;
  }
  return value;
}

function moneyOrNull(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return text(value);
}

function readRiderPoint(value: unknown): RiderPoint | null {
  if (!isRecord(value)) {
    return null;
  }
  const latitude = coordinate(value.latitude, 90);
  const longitude = coordinate(value.longitude, 180);
  if (latitude === null || longitude === null) {
    return null;
  }
  return { latitude, longitude, updatedAt: readInstant(value.updatedAt) };
}

function readPickupApproach(value: unknown): PickupApproach | null {
  if (!isRecord(value) || typeof value.metres !== 'number' || typeof value.seconds !== 'number') {
    return null;
  }
  if (!Number.isFinite(value.metres) || value.metres < 0 || !Number.isFinite(value.seconds) || value.seconds < 0) {
    return null;
  }
  const line = Array.isArray(value.line) ? value.line.flatMap((point) => {
    if (!isRecord(point)) {
      return [];
    }
    const latitude = coordinate(point.latitude, 90);
    const longitude = coordinate(point.longitude, 180);
    return latitude === null || longitude === null ? [] : [{ latitude, longitude }];
  }) : [];
  return { metres: value.metres, seconds: value.seconds, line };
}

function readInstant(value: unknown): string | null {
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
    return null;
  }
  return value;
}

function coordinatePair(latitude: unknown, longitude: unknown): { latitude: number | null; longitude: number | null } {
  const parsedLatitude = coordinate(latitude, 90);
  const parsedLongitude = coordinate(longitude, 180);
  if (parsedLatitude === null || parsedLongitude === null) {
    return { latitude: null, longitude: null };
  }
  return { latitude: parsedLatitude, longitude: parsedLongitude };
}

export function displayedCustomerOffer(delivery: { customerOffer?: string | null; suggestedPrice: string }): string {
  const offer = delivery.customerOffer?.trim();
  return offer ? offer : delivery.suggestedPrice;
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
