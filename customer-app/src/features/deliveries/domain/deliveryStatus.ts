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

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export type DeliveryGroup = 'active' | 'history';

export type CustomerDelivery = {
  id: string;
  status: DeliveryStatus;
  createdAt: string;
  pickupAddress: string;
  dropoffAddress: string;
};

const ACTIVE_DELIVERY_STATUSES = new Set<DeliveryStatus>([
  'CREATED',
  'SEARCHING',
  'NO_RIDER_FOUND',
  'ASSIGNED',
  'ARRIVED_AT_PICKUP',
  'PICKED_UP',
  'IN_TRANSIT',
  'ARRIVED_AT_DROPOFF',
]);

const ACTIVE_LIST_STATUSES: readonly DeliveryStatus[] = [...ACTIVE_DELIVERY_STATUSES];

const HISTORY_DELIVERY_STATUSES = new Set<DeliveryStatus>([
  'DELIVERED',
  'CANCELLED',
  'FAILED',
]);

const STATUS_LABELS: Record<DeliveryStatus, string> = {
  CREATED: 'Pending',
  SEARCHING: 'Finding a rider',
  NO_RIDER_FOUND: 'No rider found',
  ASSIGNED: 'Rider assigned',
  ARRIVED_AT_PICKUP: 'Rider at pickup',
  PICKED_UP: 'Picked up',
  IN_TRANSIT: 'In transit',
  ARRIVED_AT_DROPOFF: 'At dropoff',
  DELIVERED: 'Completed',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
};

export function deliveryGroup(status: DeliveryStatus): DeliveryGroup {
  return ACTIVE_DELIVERY_STATUSES.has(status) ? 'active' : 'history';
}

export function deliveriesInGroup(deliveries: CustomerDelivery[], group: DeliveryGroup): CustomerDelivery[] {
  return deliveries.filter((delivery) => deliveryGroup(delivery.status) === group);
}

export function deliveryStatusLabel(status: DeliveryStatus): string {
  return STATUS_LABELS[status];
}

export function isKnownDeliveryStatus(status: string): status is DeliveryStatus {
  return (DELIVERY_STATUSES as readonly string[]).includes(status);
}

export { ACTIVE_DELIVERY_STATUSES, ACTIVE_LIST_STATUSES, HISTORY_DELIVERY_STATUSES };
