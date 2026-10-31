import type { DeliveryStatus } from './deliveryStatus';

export type AssignedRider = {
  name: string;
  verified: boolean;
  motorcycle: string | null;
  phone: string | null;
  hasProfilePhoto: boolean;
};

const HEADING = new Set<DeliveryStatus>(['ASSIGNED', 'ARRIVED_AT_PICKUP', 'RIDER_ASSIGNED', 'COLLECTING']);
const COLLECTED = new Set<DeliveryStatus>(['PICKED_UP', 'COLLECTED']);
const TRANSIT = new Set<DeliveryStatus>(['IN_TRANSIT', 'ARRIVED_AT_DROPOFF', 'OUT_FOR_DELIVERY']);
const CANCEL_BEFORE_PICKUP = new Set<DeliveryStatus>(['RIDER_ASSIGNED', 'COLLECTING']);

export function trackingHeadline(status: DeliveryStatus, distanceMetres?: number | null): string | null {
  if (HEADING.has(status)) {
    return distanceMetres != null && Number.isFinite(distanceMetres) && distanceMetres >= 0 && Math.round(distanceMetres) === 0
      ? 'Rider arrived'
      : 'Rider on the way';
  }
  if (COLLECTED.has(status)) {
    return 'Parcel collected';
  }
  if (TRANSIT.has(status)) {
    return 'Your parcel is on the way';
  }
  if (status === 'DELIVERED') {
    return 'Parcel delivered';
  }
  return null;
}

export function customerCanCancelDelivery(status: DeliveryStatus): boolean {
  return CANCEL_BEFORE_PICKUP.has(status);
}

export function shouldShowAssignmentNotice(openedAfterAcceptance: boolean): boolean {
  return openedAfterAcceptance;
}

export function bidProfilePhotoPath(deliveryId: string, bidId: string): string {
  return `/customers/me/deliveries/${encodeURIComponent(deliveryId)}/bids/${encodeURIComponent(bidId)}/profile-photo`;
}

export function assignedRiderPhotoPath(deliveryId: string): string {
  return `/customers/me/deliveries/${encodeURIComponent(deliveryId)}/rider-profile-photo`;
}

export function riderInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter((part) => part.length > 0).slice(0, 2);
  const letters = parts.map((part) => part[0]?.toUpperCase() ?? '').join('');
  return letters || 'R';
}

export function riderDialUrl(phone: string | null): string | null {
  const value = internationalPhone(phone);
  return value ? `tel:${value}` : null;
}

export function riderWhatsAppCallUrl(phone: string | null): string | null {
  const value = internationalPhone(phone);
  return value ? `whatsapp://send?phone=${value.slice(1)}` : null;
}

function internationalPhone(phone: string | null): string | null {
  const value = phone?.trim() ?? '';
  return /^\+[1-9]\d{7,14}$/.test(value) ? value : null;
}

export function readAssignedRider(value: unknown): AssignedRider | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!name) {
    return null;
  }
  const motorcycle = typeof record.motorcycle === 'string' && record.motorcycle.trim() ? record.motorcycle.trim() : null;
  const phone = typeof record.phone === 'string' && record.phone.trim() ? record.phone.trim() : null;
  return {
    name,
    verified: record.verified === true,
    motorcycle,
    phone,
    hasProfilePhoto: record.hasProfilePhoto === true,
  };
}
