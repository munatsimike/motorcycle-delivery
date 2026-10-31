import type { CustomerDeliveryDetail } from './customerDeliveryDetail';

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
  distanceMeters: number | null;
  motorcycle: string | null;
  hasProfilePhoto: boolean;
};

export type BidAcceptance = {
  deliveryId: string;
  bidId: string;
  status: 'RIDER_ASSIGNED';
  acceptedBidAmount: string;
  replayed: boolean;
};

export function readCustomerBids(value: unknown): CustomerBid[] {
  if (!Array.isArray(value)) {
    throw new Error('Bids are unavailable.');
  }
  return value.map(readCustomerBid);
}

export function readBidAcceptance(value: unknown): BidAcceptance {
  if (!isRecord(value) || value.status !== 'RIDER_ASSIGNED') {
    throw new Error('This bid could not be accepted.');
  }
  if (typeof value.deliveryId !== 'string' || !value.deliveryId.trim()) {
    throw new Error('This bid could not be accepted.');
  }
  if (typeof value.bidId !== 'string' || !value.bidId.trim()) {
    throw new Error('This bid could not be accepted.');
  }
  if (typeof value.acceptedBidAmount !== 'string' || !MONEY.test(value.acceptedBidAmount)) {
    throw new Error('This bid could not be accepted.');
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
  return `Choose ${bid.riderName} for ${bid.currency} ${bid.amount}?`;
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
    throw new Error('Bids are unavailable.');
  }
  if (typeof value.deliveryId !== 'string' || !value.deliveryId.trim()) {
    throw new Error('Bids are unavailable.');
  }
  if (typeof value.amount !== 'string' || !MONEY.test(value.amount) || value.currency !== 'USD') {
    throw new Error('Bids are unavailable.');
  }
  if (typeof value.status !== 'string' || !BID_STATUSES.includes(value.status as CustomerBidStatus)) {
    throw new Error('Bids are unavailable.');
  }
  if (typeof value.createdAt !== 'string' || Number.isNaN(new Date(value.createdAt).getTime())) {
    throw new Error('Bids are unavailable.');
  }
  const riderName = isRecord(value.rider) && typeof value.rider.name === 'string' ? value.rider.name.trim() : '';
  if (!riderName) {
    throw new Error('Bids are unavailable.');
  }
  const completedDeliveries = readCount(isRecord(value.rider) ? value.rider.completedDeliveries : undefined);
  const distanceMeters = readDistance(isRecord(value.rider) ? value.rider.distanceMeters : undefined);
  const motorcycle = readMotorcycle(isRecord(value.rider) ? value.rider.motorcycle : undefined);
  if (completedDeliveries === undefined || distanceMeters === undefined || motorcycle === undefined) {
    throw new Error('Bids are unavailable.');
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
    distanceMeters,
    motorcycle,
    hasProfilePhoto: isRecord(value.rider) && value.rider.hasProfilePhoto === true,
  };
}

function readMotorcycle(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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
