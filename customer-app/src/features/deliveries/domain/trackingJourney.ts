import type { DeliveryStatus } from './deliveryStatus';

export type AssignedRider = {
  name: string;
  verified: boolean;
  motorcycle: string | null;
  registrationNumber: string | null;
  colour: string | null;
  phone: string | null;
  hasProfilePhoto: boolean;
};

const HEADING = new Set<DeliveryStatus>(['ASSIGNED', 'ARRIVED_AT_PICKUP', 'RIDER_ASSIGNED', 'COLLECTING']);
const COLLECTED = new Set<DeliveryStatus>(['PICKED_UP', 'COLLECTED', 'OUT_FOR_DELIVERY']);
const TRANSIT = new Set<DeliveryStatus>(['IN_TRANSIT', 'ARRIVED_AT_DROPOFF']);
const CANCEL_BEFORE_PICKUP = new Set<DeliveryStatus>(['RIDER_ASSIGNED', 'COLLECTING']);

export function trackingHeadline(status: DeliveryStatus, distanceMetres?: number | null): string | null {
  if (HEADING.has(status)) {
    if (distanceMetres != null && Number.isFinite(distanceMetres) && distanceMetres >= 0 && Math.round(distanceMetres) === 0) {
      return 'Rider arrived';
    }
    return status === 'RIDER_ASSIGNED' || status === 'COLLECTING' ? 'Rider coming' : 'Rider on the way';
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

export function trackingSubtitle(headline: string | null, dropoffAddress?: string | null): string | null {
  if (headline === 'Rider coming' || headline === 'Rider on the way') {
    return 'Your rider is coming to pick up your parcel.';
  }
  if (headline === 'Rider arrived') {
    return 'Handover your parcel to the rider.';
  }
  if (headline === 'Parcel collected') {
    const address = dropoffAddress?.trim();
    return address ? `On its way to ${address}.` : null;
  }
  return null;
}

export function customerCanCancelDelivery(status: DeliveryStatus): boolean {
  return CANCEL_BEFORE_PICKUP.has(status);
}

export const ASSIGNMENT_NOTICE_MS = 2400;

export function shouldShowAssignmentNotice(openedAfterAcceptance: boolean): boolean {
  return openedAfterAcceptance;
}

export function assignmentNoticeVisible(openedAfterAcceptance: boolean, elapsedMs: number): boolean {
  return shouldShowAssignmentNotice(openedAfterAcceptance) && elapsedMs >= 0 && elapsedMs < ASSIGNMENT_NOTICE_MS;
}

export function bidProfilePhotoPath(deliveryId: string, bidId: string): string {
  return `/customers/me/deliveries/${encodeURIComponent(deliveryId)}/bids/${encodeURIComponent(bidId)}/profile-photo`;
}

export function assignedRiderPhotoPath(deliveryId: string): string {
  return `/customers/me/deliveries/${encodeURIComponent(deliveryId)}/rider-profile-photo`;
}

export function riderBikeLine(motorcycle: string | null, registrationNumber: string | null): string | null {
  const line = [motorcycle, registrationNumber].filter((part): part is string => Boolean(part)).join(' ');
  return line || null;
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
  const registrationNumber = typeof record.registrationNumber === 'string' && record.registrationNumber.trim()
    ? record.registrationNumber.trim()
    : null;
  const colour = typeof record.colour === 'string' && record.colour.trim() ? record.colour.trim() : null;
  const phone = typeof record.phone === 'string' && record.phone.trim() ? record.phone.trim() : null;
  return {
    name,
    verified: record.verified === true,
    motorcycle,
    registrationNumber,
    colour,
    phone,
    hasProfilePhoto: record.hasProfilePhoto === true,
  };
}
