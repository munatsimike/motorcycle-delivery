import { isKnownDeliveryStatus, type CustomerDelivery, type DeliveryStatus } from './deliveryStatus';

export type CustomerDeliveryPage = {
  deliveries: CustomerDelivery[];
  page: number;
  totalPages: number;
};

export function customerDeliveryListPath(page: number, statuses?: readonly DeliveryStatus[]): string {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', '20');
  for (const status of statuses ?? []) {
    params.append('status', status);
  }
  return `/customers/me/deliveries?${params.toString()}`;
}

export function readCustomerDeliveryPage(value: unknown): CustomerDeliveryPage {
  if (!isRecord(value) || !Array.isArray(value.data) || !isRecord(value.pagination)) {
    throw new Error('Deliveries are unavailable.');
  }
  const page = wholeNumber(value.pagination.page);
  const totalPages = wholeNumber(value.pagination.totalPages);
  if (page === null || totalPages === null) {
    throw new Error('Deliveries are unavailable.');
  }
  return {
    deliveries: uniqueDeliveries(value.data.map(readCustomerDelivery)),
    page,
    totalPages,
  };
}

export function replaceDeliveries(incoming: CustomerDelivery[]): CustomerDelivery[] {
  return uniqueDeliveries(incoming);
}

export function appendDeliveries(current: CustomerDelivery[], incoming: CustomerDelivery[]): CustomerDelivery[] {
  return uniqueDeliveries([...current, ...incoming]);
}

export function deliveryTrackingTarget(deliveryId: string) {
  return {
    screen: 'DeliveryTracking' as const,
    params: { deliveryId },
  };
}

function readCustomerDelivery(value: unknown): CustomerDelivery {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.trim().length === 0) {
    throw new Error('Deliveries are unavailable.');
  }
  if (typeof value.status !== 'string' || !isKnownDeliveryStatus(value.status)) {
    throw new Error('Deliveries are unavailable.');
  }
  if (typeof value.reference !== 'string' || value.reference.trim().length === 0) {
    throw new Error('Deliveries are unavailable.');
  }
  if (typeof value.createdAt !== 'string' || value.createdAt.trim().length === 0) {
    throw new Error('Deliveries are unavailable.');
  }
  const pickupAddress = addressOf(value.pickup);
  const dropoffAddress = addressOf(value.dropoff);
  if (!pickupAddress || !dropoffAddress) {
    throw new Error('Deliveries are unavailable.');
  }
  const serviceClass = readServiceClass(value.serviceClass);
  const deliverBy = readDeadline(value.deliverBy);
  const suggestedPrice = readMoney(value.suggestedPrice);
  const offeredPrice = readMoney(value.offeredPrice);
  const currency = readCurrency(value.currency);
  if (
    serviceClass === undefined
    || deliverBy === undefined
    || suggestedPrice === undefined
    || offeredPrice === undefined
    || currency === undefined
  ) {
    throw new Error('Deliveries are unavailable.');
  }
  return {
    id: value.id,
    status: value.status,
    createdAt: value.createdAt,
    pickupAddress,
    dropoffAddress,
    serviceClass,
    deliverBy,
    currency,
    suggestedPrice,
    offeredPrice,
  };
}

function readServiceClass(value: unknown): 'EXPRESS' | 'FLEXIBLE' | null | undefined {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (value === 'EXPRESS' || value === 'FLEXIBLE') {
    return value;
  }
  return undefined;
}

function readDeadline(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
    return undefined;
  }
  return value;
}

function readMoney(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string' || !/^\d{1,10}\.\d{2}$/.test(value)) {
    return undefined;
  }
  return value;
}

function readCurrency(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (value !== 'USD') {
    return undefined;
  }
  return 'USD';
}

function addressOf(value: unknown): string | null {
  if (!isRecord(value) || typeof value.address !== 'string' || value.address.trim().length === 0) {
    return null;
  }
  return value.address.trim();
}

function uniqueDeliveries(deliveries: CustomerDelivery[]): CustomerDelivery[] {
  const seen = new Set<string>();
  const unique: CustomerDelivery[] = [];
  for (const delivery of deliveries) {
    if (seen.has(delivery.id)) {
      continue;
    }
    seen.add(delivery.id);
    unique.push(delivery);
  }
  return unique;
}

function wholeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
