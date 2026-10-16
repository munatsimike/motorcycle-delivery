import { isKnownDeliveryStatus, type DeliveryStatus } from './deliveryStatus';

export type CustomerDeliveryDetail = {
  id: string;
  status: DeliveryStatus;
  currency: string;
  offeredPrice: string;
  suggestedPrice: string;
  distanceMeters: number;
  pickupAddress: string;
  dropoffAddress: string;
  parcelDescription: string;
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
  const dropoffAddress = text(value.dropoff.address);
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
    dropoffAddress,
    parcelDescription,
  };
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
