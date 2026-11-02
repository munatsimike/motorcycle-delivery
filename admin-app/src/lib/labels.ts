const WORDS: Record<string, string> = {
  CREATED: 'Created',
  RIDER_ASSIGNED: 'Rider assigned',
  COLLECTING: 'Collecting',
  COLLECTED: 'Collected',
  OUT_FOR_DELIVERY: 'Out for delivery',
  EXPRESS: 'Express',
  FLEXIBLE: 'Flexible',
  OPEN: 'Open',
  WITHDRAWN: 'Withdrawn',
  ACCEPTED: 'Accepted',
  SUPERSEDED: 'Superseded',
  EXPIRED: 'Expired',
  SEARCHING: 'Searching',
  NO_RIDER_FOUND: 'No rider found',
  ASSIGNED: 'Assigned',
  ARRIVED_AT_PICKUP: 'Arrived at pickup',
  PICKED_UP: 'Picked up',
  IN_TRANSIT: 'In transit',
  ARRIVED_AT_DROPOFF: 'Arrived at drop-off',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
  PENDING: 'Pending',
  APPROVED: 'Approved',
  SUSPENDED: 'Suspended',
  REJECTED: 'Rejected',
  VERIFIED: 'Verified',
  REVOKED: 'Revoked',
  AVAILABLE: 'Available',
  BUSY: 'Busy',
  OFFLINE: 'Offline',
  ACTIVE: 'Active',
  INDIVIDUAL: 'Individual',
  BUSINESS: 'Business',
  CASH: 'Cash',
  ECOCASH: 'EcoCash',
  ON_COMPLETION: 'On completion',
  ON_ACCEPTANCE: 'On acceptance',
  OFF_PEAK: 'Off-peak',
  SENT: 'Sent',
  TOP_UP: 'Top-up',
  PROMOTIONAL_CREDIT: 'Promotional credit',
  PLATFORM_FEE: 'Platform fee',
  PLATFORM_FEE_HOLD: 'Platform fee hold',
  PLATFORM_FEE_RELEASE: 'Platform fee release',
  PLATFORM_FEE_REFUND: 'Platform fee refund',
  WELCOME_BONUS: 'Welcome bonus',
  ADJUSTMENT: 'Adjustment',
  BID_ACCEPTED: 'Offer accepted',
  REQUEST_REOPENED: 'Request reopened',
  DEADLINE_REMINDER: 'Deadline reminder',
  RIDER_OPPORTUNITY: 'Rider opportunity',
  BID_RECEIVED: 'Offer received',
  COUNTEROFFER: 'Counteroffer',
  ACCOUNT_APPROVED: 'Account approved',
  provider_timeout: 'Provider timed out',
  provider_unavailable: 'Provider unavailable',
  not_available: 'No longer available',
};

export const NOTICE_STATUSES = ['PENDING', 'SENT', 'FAILED'] as const;

export const NOTICE_EVENT_TYPES = [
  'BID_ACCEPTED',
  'REQUEST_REOPENED',
  'COLLECTING',
  'COLLECTED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'DEADLINE_REMINDER',
  'RIDER_OPPORTUNITY',
  'BID_RECEIVED',
  'COUNTEROFFER',
  'ACCOUNT_APPROVED',
] as const;

export function label(value: string): string {
  return WORDS[value] ?? value.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}

export function when(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export const DELIVERY_STATUSES = [
  'CREATED',
  'SEARCHING',
  'NO_RIDER_FOUND',
  'ASSIGNED',
  'ARRIVED_AT_PICKUP',
  'PICKED_UP',
  'IN_TRANSIT',
  'ARRIVED_AT_DROPOFF',
  'DELIVERED',
  'CANCELLED',
  'FAILED',
  'RIDER_ASSIGNED',
  'COLLECTING',
  'COLLECTED',
  'OUT_FOR_DELIVERY',
] as const;
