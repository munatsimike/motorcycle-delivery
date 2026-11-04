import type { CustomerDeliveryDetail } from './customerDeliveryDetail';
import { moneyLabel } from './moneyLabel';
import { readRiderClass, type RiderClassName } from './riderClass';

const MONEY = /^\d{1,10}\.\d{2}$/;
const BID_STATUSES = ['OPEN', 'WITHDRAWN', 'ACCEPTED', 'SUPERSEDED', 'EXPIRED'] as const;

export type CustomerBidStatus = (typeof BID_STATUSES)[number];

export type CustomerBid = {
  id: string;
  deliveryId: string;
  amount: string;
  currency: 'USD';
  status: CustomerBidStatus;
  createdAt: string;
  riderName: string;
  verified: boolean;
  completedDeliveries: number;
  averageRating: number | null;
  ratingCount: number;
  riderClass: RiderClassName;
  distanceMeters: number | null;
  motorcycle: string | null;
  registrationNumber: string | null;
  hasProfilePhoto: boolean;
  pickupEtaSeconds: number | null;
};

export type BidAcceptance = {
  deliveryId: string;
  bidId: string;
  status: 'RIDER_ASSIGNED';
  acceptedBidAmount: string;
  replayed: boolean;
  selectedRiderAssigned?: boolean;
  assignedRiderName?: string | null;
};

export type SelectedBid = {
  bidId: string;
  riderName: string;
};

export function readCustomerBids(value: unknown): CustomerBid[] {
  if (!Array.isArray(value)) {
    throw new Error('Offers are unavailable.');
  }
  return value.map(readCustomerBid);
}

export function readBidAcceptance(value: unknown): BidAcceptance {
  if (!isRecord(value) || value.status !== 'RIDER_ASSIGNED') {
    throw new Error('This offer could not be accepted.');
  }
  if (typeof value.deliveryId !== 'string' || !value.deliveryId.trim()) {
    throw new Error('This offer could not be accepted.');
  }
  if (typeof value.bidId !== 'string' || !value.bidId.trim()) {
    throw new Error('This offer could not be accepted.');
  }
  if (typeof value.acceptedBidAmount !== 'string' || !MONEY.test(value.acceptedBidAmount)) {
    throw new Error('This offer could not be accepted.');
  }
  return {
    deliveryId: value.deliveryId,
    bidId: value.bidId,
    status: 'RIDER_ASSIGNED',
    acceptedBidAmount: value.acceptedBidAmount,
    replayed: value.replayed === true,
  };
}

export function bidCanAccept(bid: CustomerBid): boolean {
  return bid.status === 'OPEN';
}

export function acceptableBids(bids: readonly CustomerBid[]): CustomerBid[] {
  return bids.filter(bidCanAccept);
}

export function acceptancePrompt(bid: CustomerBid): string {
  return `Choose ${bid.riderName} for ${moneyLabel(bid.currency, bid.amount)}?`;
}

export function agreedPriceDiffers(agreed: string, suggested: string): boolean {
  return agreed !== suggested;
}

export function committedDelivery(delivery: CustomerDeliveryDetail, acceptance: BidAcceptance): CustomerDeliveryDetail {
  if (acceptance.deliveryId !== delivery.id) {
    return delivery;
  }
  return {
    ...delivery,
    status: 'RIDER_ASSIGNED',
    offeredPrice: acceptance.acceptedBidAmount,
    riderLocation: null,
  };
}

export function waitsForRiderConfirmation(): boolean {
  return false;
}

export function startsRiderSearch(): boolean {
  return false;
}

export function keepsAcceptanceKey(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return /timed out|network request failed|connection/i.test(message);
}

export const RIDER_SELECTION_IN_PROGRESS = 'Rider selection is already in progress.';

export function duplicateAcceptanceNotice(began: boolean): string | null {
  return began ? null : RIDER_SELECTION_IN_PROGRESS;
}

export function riderNamesMatch(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function confirmationRiderName(acceptance: BidAcceptance, selectedRiderName: string): string {
  const assigned = acceptance.assignedRiderName?.trim();
  return assigned || selectedRiderName;
}

export function confirmRiderSheetState(acceptingId: string | null, bidId: string | null) {
  const loading = bidId !== null && acceptingId === bidId;
  return {
    loading,
    confirmLocked: loading,
    keepComparingLocked: loading,
  };
}

export function acceptanceFromAssignedDelivery(
  delivery: CustomerDeliveryDetail,
  selected: SelectedBid,
): BidAcceptance | null {
  if (delivery.status !== 'RIDER_ASSIGNED' && delivery.status !== 'COLLECTING') {
    return null;
  }
  if (typeof delivery.offeredPrice !== 'string' || !MONEY.test(delivery.offeredPrice)) {
    return null;
  }
  const assignedRiderName = delivery.rider?.name?.trim() || null;
  return {
    deliveryId: delivery.id,
    bidId: selected.bidId,
    status: 'RIDER_ASSIGNED',
    acceptedBidAmount: delivery.offeredPrice,
    replayed: true,
    assignedRiderName,
    selectedRiderAssigned: assignedRiderName !== null && riderNamesMatch(assignedRiderName, selected.riderName),
  };
}

export function createAcceptanceGate() {
  let active = false;
  return {
    begin(): boolean {
      if (active) {
        return false;
      }
      active = true;
      return true;
    },
    end() {
      active = false;
    },
  };
}

export function bidsAfterFailure(current: readonly CustomerBid[]): CustomerBid[] {
  return [...current];
}

function readCustomerBid(value: unknown): CustomerBid {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) {
    throw new Error('Offers are unavailable.');
  }
  if (typeof value.deliveryId !== 'string' || !value.deliveryId.trim()) {
    throw new Error('Offers are unavailable.');
  }
  if (typeof value.amount !== 'string' || !MONEY.test(value.amount) || value.currency !== 'USD') {
    throw new Error('Offers are unavailable.');
  }
  if (typeof value.status !== 'string' || !BID_STATUSES.includes(value.status as CustomerBidStatus)) {
    throw new Error('Offers are unavailable.');
  }
  if (typeof value.createdAt !== 'string' || Number.isNaN(new Date(value.createdAt).getTime())) {
    throw new Error('Offers are unavailable.');
  }
  const riderName = isRecord(value.rider) && typeof value.rider.name === 'string' ? value.rider.name.trim() : '';
  if (!riderName) {
    throw new Error('Offers are unavailable.');
  }
  const completedDeliveries = readCount(isRecord(value.rider) ? value.rider.completedDeliveries : undefined);
  const ratingCount = readCount(isRecord(value.rider) ? value.rider.ratingCount : undefined) ?? 0;
  const averageRating = readAverageRating(isRecord(value.rider) ? value.rider.averageRating : undefined, ratingCount);
  const distanceMeters = readDistance(isRecord(value.rider) ? value.rider.distanceMeters : undefined);
  const motorcycle = readMotorcycle(isRecord(value.rider) ? value.rider.motorcycle : undefined);
  const registrationNumber = readMotorcycle(isRecord(value.rider) ? value.rider.registrationNumber : undefined);
  if (completedDeliveries === undefined || distanceMeters === undefined || motorcycle === undefined || registrationNumber === undefined) {
    throw new Error('Offers are unavailable.');
  }
  return {
    id: value.id,
    deliveryId: value.deliveryId,
    amount: value.amount,
    currency: 'USD',
    status: value.status as CustomerBidStatus,
    createdAt: value.createdAt,
    riderName,
    verified: isRecord(value.rider) && value.rider.verified === true,
    completedDeliveries,
    averageRating,
    ratingCount,
    riderClass: readRiderClass(isRecord(value.rider) ? value.rider.riderClass : undefined),
    distanceMeters,
    motorcycle,
    registrationNumber,
    hasProfilePhoto: isRecord(value.rider) && value.rider.hasProfilePhoto === true,
    pickupEtaSeconds: readEtaSeconds(isRecord(value.rider) ? value.rider.pickupEtaSeconds : undefined),
  };
}

function readMotorcycle(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readAverageRating(value: unknown, ratingCount: number): number | null {
  if (ratingCount <= 0) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 5) {
    return null;
  }
  return Math.round(value * 10) / 10;
}

function readCount(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return 0;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return undefined;
  }
  return value;
}

function readEtaSeconds(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.round(value);
}

function readDistance(value: unknown): number | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return undefined;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
