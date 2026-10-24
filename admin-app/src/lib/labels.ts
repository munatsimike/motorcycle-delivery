const WORDS: Record<string, string> = {
  CREATED: 'Created',
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
};

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
] as const;
