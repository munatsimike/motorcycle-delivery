import type { Currency, DeliveryPayer, DeliveryStatus, ParcelSize, PaymentMethod } from '../generated/prisma/client.js';
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
  pickupLatitude: string | { toFixed(digits: number): string };
  pickupLongitude: string | { toFixed(digits: number): string };
  pickupAddress: string;
  pickupLandmark: string | null;
  pickupInstructions: string | null;
  pickupContactName: string;
  pickupContactPhone: string;
  dropoffLatitude: string | { toFixed(digits: number): string };
  dropoffLongitude: string | { toFixed(digits: number): string };
  dropoffAddress: string;
  dropoffLandmark: string | null;
  dropoffInstructions: string | null;
  recipientName: string;
  recipientPhone: string;
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
      delivery.pickupLatitude,
      delivery.pickupLongitude,
      delivery.pickupAddress,
      delivery.pickupLandmark,
      delivery.pickupInstructions,
      delivery.pickupContactName,
      delivery.pickupContactPhone,
    ),
    dropoff: stop(
      delivery.dropoffLatitude,
      delivery.dropoffLongitude,
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
  latitude: string | { toFixed(digits: number): string },
  longitude: string | { toFixed(digits: number): string },
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

function decimalText(value: string | { toFixed(digits: number): string }, digits: number): string {
  return typeof value === 'string' ? value : value.toFixed(digits);
}


