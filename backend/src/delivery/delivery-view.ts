import type { CoordinateSource, Currency, DeliveryPayer, DeliveryStatus, ParcelSize, PaymentMethod } from '../generated/prisma/client.js';
import { shouldWithholdCoordinates } from './coordinate-retention.js';
import { centsFromDecimal, formatCents } from './money.js';

export type StoredDelivery = {
  id: string;
  status: DeliveryStatus;
  searchGeneration?: number;
  autoRetryCount?: number;
  nextRetryAt?: Date | null;
  currency: Currency;
  payer: DeliveryPayer;
  paymentMethod: PaymentMethod;
  distanceMeters: number;
  pricingVersion: number;
  price: string | { toFixed(digits: number): string };
  suggestedPrice: string | { toFixed(digits: number): string };
  pickupLatitude: string | { toFixed(digits: number): string } | null;
  pickupLongitude: string | { toFixed(digits: number): string } | null;
  pickupAddress: string;
  pickupLandmark: string | null;
  pickupInstructions: string | null;
  pickupContactName: string;
  pickupContactPhone: string;
  pickupCoordinateSource?: CoordinateSource;
  pickupPlaceId?: string | null;
  pickupCoordinateRetrievedAt?: Date | null;
  pickupCoordinateRefreshAttemptedAt?: Date | null;
  dropoffLatitude: string | { toFixed(digits: number): string } | null;
  dropoffLongitude: string | { toFixed(digits: number): string } | null;
  dropoffAddress: string;
  dropoffLandmark: string | null;
  dropoffInstructions: string | null;
  recipientName: string;
  recipientPhone: string;
  dropoffCoordinateSource?: CoordinateSource;
  dropoffPlaceId?: string | null;
  dropoffCoordinateRetrievedAt?: Date | null;
  dropoffCoordinateRefreshAttemptedAt?: Date | null;
  parcelDescription: string;
  parcelSize: ParcelSize;
  parcelInstructions: string | null;
  createdAt?: Date | string;
};

export function toCustomerDeliverySummary(delivery: {
  id: string;
  status: DeliveryStatus;
  createdAt: Date;
  pickupAddress: string;
  dropoffAddress: string;
}) {
  return {
    id: delivery.id,
    reference: delivery.id,
    status: delivery.status,
    createdAt: delivery.createdAt,
    pickup: { address: delivery.pickupAddress },
    dropoff: { address: delivery.dropoffAddress },
  };
}

export function toCustomerDelivery(delivery: StoredDelivery) {
  return {
    id: delivery.id,
    status: delivery.status,
    searchGeneration: delivery.searchGeneration ?? 0,
    autoRetryCount: delivery.autoRetryCount ?? 0,
    nextRetryAt: delivery.nextRetryAt ?? null,
    currency: delivery.currency,
    payer: delivery.payer,
    paymentMethod: delivery.paymentMethod,
    distanceMeters: delivery.distanceMeters,
    pricingVersion: delivery.pricingVersion,
    suggestedPrice: formatCents(centsFromDecimal(delivery.suggestedPrice)),
    offeredPrice: formatCents(centsFromDecimal(delivery.price)),
    pickup: stop(
      withheldCoordinate(delivery, 'pickup', delivery.pickupLatitude),
      withheldCoordinate(delivery, 'pickup', delivery.pickupLongitude),
      delivery.pickupAddress,
      delivery.pickupLandmark,
      delivery.pickupInstructions,
      delivery.pickupContactName,
      delivery.pickupContactPhone,
    ),
    dropoff: stop(
      withheldCoordinate(delivery, 'dropoff', delivery.dropoffLatitude),
      withheldCoordinate(delivery, 'dropoff', delivery.dropoffLongitude),
      delivery.dropoffAddress,
      delivery.dropoffLandmark,
      delivery.dropoffInstructions,
      delivery.recipientName,
      delivery.recipientPhone,
    ),
    parcel: {
      description: delivery.parcelDescription,
      size: delivery.parcelSize,
      instructions: delivery.parcelInstructions,
    },
    createdAt: createdAtText(delivery.createdAt),
  };
}

function withheldCoordinate(
  delivery: StoredDelivery,
  side: 'pickup' | 'dropoff',
  value: string | { toFixed(digits: number): string } | null,
): string | { toFixed(digits: number): string } | null {
  const withheld = shouldWithholdCoordinates(
    delivery.status,
    delivery.createdAt,
    side === 'pickup'
      ? {
        source: delivery.pickupCoordinateSource,
        placeId: delivery.pickupPlaceId,
        latitude: coordinateMarker(delivery.pickupLatitude),
        longitude: coordinateMarker(delivery.pickupLongitude),
        retrievedAt: delivery.pickupCoordinateRetrievedAt,
        refreshAttemptedAt: delivery.pickupCoordinateRefreshAttemptedAt,
      }
      : {
        source: delivery.dropoffCoordinateSource,
        placeId: delivery.dropoffPlaceId,
        latitude: coordinateMarker(delivery.dropoffLatitude),
        longitude: coordinateMarker(delivery.dropoffLongitude),
        retrievedAt: delivery.dropoffCoordinateRetrievedAt,
        refreshAttemptedAt: delivery.dropoffCoordinateRefreshAttemptedAt,
      },
    new Date(),
  );
  return withheld ? null : value;
}

function coordinateMarker(value: string | { toFixed(digits: number): string } | null): string | null {
  return value == null ? null : 'present';
}

function createdAtText(value: Date | string | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function toRiderDelivery(delivery: StoredDelivery) {
  const view = toCustomerDelivery(delivery);
  return {
    id: view.id,
    status: view.status,
    currency: view.currency,
    payer: view.payer,
    paymentMethod: view.paymentMethod,
    distanceMeters: view.distanceMeters,
    pricingVersion: view.pricingVersion,
    offeredPrice: view.offeredPrice,
    pickup: view.pickup,
    dropoff: view.dropoff,
    parcel: view.parcel,
  };
}

function stop(
  latitude: string | { toFixed(digits: number): string } | null,
  longitude: string | { toFixed(digits: number): string } | null,
  address: string,
  landmark: string | null,
  instructions: string | null,
  contactName: string,
  contactPhone: string,
) {
  return {
    latitude: decimalText(latitude, 7),
    longitude: decimalText(longitude, 7),
    address,
    landmark,
    instructions,
    contactName,
    contactPhone,
  };
}

function decimalText(value: string | { toFixed(digits: number): string } | null, digits: number): string | null {
  if (value == null) {
    return null;
  }
  return typeof value === 'string' ? value : value.toFixed(digits);
}


