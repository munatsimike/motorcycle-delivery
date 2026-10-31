import { isKnownDeliveryStatus, type CustomerDelivery, type DeliveryStatus } from './deliveryStatus';

export const RECENT_DELIVERY_CACHE_VERSION = 1;
export const RECENT_DELIVERY_CACHE_LIMIT = 5;
export const SECURE_STORE_VALUE_LIMIT = 1800;

export type RecentDeliverySnapshot = {
  schemaVersion: typeof RECENT_DELIVERY_CACHE_VERSION;
  customerId: string;
  savedAt: string;
  syncGeneration: number;
  deliveries: CustomerDelivery[];
};

export type SyncClock = {
  issued: number;
  committed: number;
};

export function issueSyncGeneration(clock: SyncClock): number {
  clock.issued += 1;
  return clock.issued;
}

export function commitSyncGeneration(clock: SyncClock, generation: number): boolean {
  if (!Number.isInteger(generation) || generation <= clock.committed) {
    return false;
  }
  clock.committed = generation;
  return true;
}

export function snapshotFromDeliveries(
  customerId: string,
  deliveries: readonly CustomerDelivery[],
  savedAt: string,
  syncGeneration: number,
): RecentDeliverySnapshot | null {
  const id = customerId.trim();
  if (!id || !Number.isFinite(Date.parse(savedAt)) || !Number.isInteger(syncGeneration) || syncGeneration < 1) {
    return null;
  }
  return {
    schemaVersion: RECENT_DELIVERY_CACHE_VERSION,
    customerId: id,
    savedAt,
    syncGeneration,
    deliveries: limitDeliveries(deliveries),
  };
}

export function applyDeliveryRefresh(
  current: RecentDeliverySnapshot | null,
  update: {
    customerId: string;
    deliveries: readonly CustomerDelivery[] | null;
    savedAt: string;
    syncGeneration: number;
  },
): RecentDeliverySnapshot | null | 'keep' {
  if (update.deliveries === null) {
    return 'keep';
  }
  if (
    current
    && current.customerId === update.customerId.trim()
    && update.syncGeneration <= current.syncGeneration
  ) {
    return 'keep';
  }
  if (update.deliveries.length === 0) {
    return null;
  }
  return snapshotFromDeliveries(update.customerId, update.deliveries, update.savedAt, update.syncGeneration);
}

export function readRecentDeliverySnapshot(value: unknown, customerId: string): RecentDeliverySnapshot | null {
  if (!isRecord(value) || value.schemaVersion !== RECENT_DELIVERY_CACHE_VERSION) {
    return null;
  }
  const id = typeof value.customerId === 'string' ? value.customerId.trim() : '';
  if (!id || id !== customerId.trim()) {
    return null;
  }
  if (typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt))) {
    return null;
  }
  if (typeof value.syncGeneration !== 'number' || !Number.isInteger(value.syncGeneration) || value.syncGeneration < 1) {
    return null;
  }
  if (!Array.isArray(value.deliveries)) {
    return null;
  }
  const deliveries: CustomerDelivery[] = [];
  for (const item of value.deliveries) {
    const delivery = readCachedDelivery(item);
    if (!delivery) {
      return null;
    }
    deliveries.push(delivery);
  }
  return {
    schemaVersion: RECENT_DELIVERY_CACHE_VERSION,
    customerId: id,
    savedAt: value.savedAt,
    syncGeneration: value.syncGeneration,
    deliveries: limitDeliveries(deliveries),
  };
}

export function deliveryListFailure(error: unknown): 'authentication' | 'unavailable' {
  const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : null;
  return status === 401 || status === 403 ? 'authentication' : 'unavailable';
}

export function savedDeliveryMessage(savedAt: string): string | null {
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const when = `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}, ${hours}:${minutes}`;
  return `Last updated ${when}. Statuses may have changed.`;
}

export function shouldRefreshSavedDeliveries(appState: string, showingSaved: boolean): boolean {
  return appState === 'active' && showingSaved;
}

export function shouldRefreshDeliveriesOnForeground(appState: string, focused: boolean): boolean {
  return appState === 'active' && focused;
}

export function splitSecureValue(value: string, limit = SECURE_STORE_VALUE_LIMIT): string[] {
  if (limit < 1) {
    throw new Error('Secure store limit is invalid.');
  }
  const parts: string[] = [];
  for (let index = 0; index < value.length; index += limit) {
    parts.push(value.slice(index, index + limit));
  }
  return parts.length > 0 ? parts : [''];
}

function limitDeliveries(deliveries: readonly CustomerDelivery[]): CustomerDelivery[] {
  const seen = new Set<string>();
  const unique: CustomerDelivery[] = [];
  for (const delivery of deliveries) {
    if (seen.has(delivery.id)) {
      continue;
    }
    seen.add(delivery.id);
    unique.push({
      id: delivery.id,
      status: delivery.status,
      createdAt: delivery.createdAt,
      pickupAddress: delivery.pickupAddress,
      dropoffAddress: delivery.dropoffAddress,
      serviceClass: delivery.serviceClass ?? null,
      deliverBy: delivery.deliverBy ?? null,
      currency: delivery.currency ?? null,
      suggestedPrice: delivery.suggestedPrice ?? null,
      offeredPrice: delivery.offeredPrice ?? null,
      distanceMeters: delivery.distanceMeters ?? null,
      parcelDescription: delivery.parcelDescription ?? null,
    });
    if (unique.length === RECENT_DELIVERY_CACHE_LIMIT) {
      break;
    }
  }
  return unique;
}

function readCachedDelivery(value: unknown): CustomerDelivery | null {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.trim().length === 0) {
    return null;
  }
  if (typeof value.status !== 'string' || !isKnownDeliveryStatus(value.status)) {
    return null;
  }
  if (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) {
    return null;
  }
  if (typeof value.pickupAddress !== 'string' || value.pickupAddress.trim().length === 0) {
    return null;
  }
  if (typeof value.dropoffAddress !== 'string' || value.dropoffAddress.trim().length === 0) {
    return null;
  }
  const status: DeliveryStatus = value.status;
  return {
    id: value.id.trim(),
    status,
    createdAt: value.createdAt,
    pickupAddress: value.pickupAddress.trim(),
    dropoffAddress: value.dropoffAddress.trim(),
    serviceClass: value.serviceClass === 'EXPRESS' || value.serviceClass === 'FLEXIBLE' ? value.serviceClass : null,
    deliverBy: typeof value.deliverBy === 'string' && value.deliverBy.trim() ? value.deliverBy : null,
    currency: value.currency === 'USD' ? 'USD' : null,
    suggestedPrice: typeof value.suggestedPrice === 'string' && value.suggestedPrice.trim() ? value.suggestedPrice : null,
    offeredPrice: typeof value.offeredPrice === 'string' && value.offeredPrice.trim() ? value.offeredPrice : null,
    distanceMeters: typeof value.distanceMeters === 'number' && Number.isFinite(value.distanceMeters) && value.distanceMeters >= 0
      ? Math.round(value.distanceMeters)
      : null,
    parcelDescription: typeof value.parcelDescription === 'string' && value.parcelDescription.trim()
      ? value.parcelDescription.trim()
      : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
