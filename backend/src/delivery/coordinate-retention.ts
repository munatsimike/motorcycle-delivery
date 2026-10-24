import { DeliveryStatus, CoordinateSource } from '../generated/prisma/client.js';
import { randomUUID } from 'node:crypto';
import { isPlaceId } from './google-places.js';

// Google latitude and longitude may be stored for 30 consecutive days.
// The deletion buffer is at least the longest allowed schedule gap, so an
// hourly pass clears them before that hard limit. This pass deletes them
// from the live deliveries table only. It does not delete backups or WAL.
// A restore can copy coordinates back. Read paths withhold any stop that is
// already due for deletion, so those coordinates are not served while cleanup
// is still pending. After a restore, keep the schedule off only if that
// withhold stays in place; storage compliance still needs the cleanup pass.

export const COORDINATE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const COORDINATE_REFRESH_LEAD_MS = 24 * 60 * 60 * 1000;
export const COORDINATE_RETENTION_LEASE_MS = 2 * 60 * 1000;
export const COORDINATE_RETENTION_BATCH = 25;
export const COORDINATE_RETENTION_MAX_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const COORDINATE_DELETION_BUFFER_MS = COORDINATE_RETENTION_MAX_INTERVAL_MS + 15 * 60 * 1000;
const RETENTION_DRAIN_LIMIT = 40;

export const ACTIVE_DELIVERY_STATUSES: readonly DeliveryStatus[] = [
  DeliveryStatus.CREATED,
  DeliveryStatus.SEARCHING,
  DeliveryStatus.NO_RIDER_FOUND,
  DeliveryStatus.ASSIGNED,
  DeliveryStatus.RIDER_ASSIGNED,
  DeliveryStatus.COLLECTING,
  DeliveryStatus.COLLECTED,
  DeliveryStatus.OUT_FOR_DELIVERY,
  DeliveryStatus.ARRIVED_AT_PICKUP,
  DeliveryStatus.PICKED_UP,
  DeliveryStatus.IN_TRANSIT,
  DeliveryStatus.ARRIVED_AT_DROPOFF,
];

export const TERMINAL_DELIVERY_STATUSES: readonly DeliveryStatus[] = [
  DeliveryStatus.DELIVERED,
  DeliveryStatus.CANCELLED,
  DeliveryStatus.FAILED,
];

const ACTIVE = new Set<DeliveryStatus>(ACTIVE_DELIVERY_STATUSES);

export type StopSide = 'pickup' | 'dropoff';

export type StoredStop = {
  source: CoordinateSource;
  placeId: string | null;
  latitude: string | null;
  longitude: string | null;
  retrievedAt: Date | null;
  refreshAttemptedAt: Date | null;
};

export type StoredRetentionDelivery = {
  id: string;
  status: DeliveryStatus;
  createdAt: Date;
  pickup: StoredStop;
  dropoff: StoredStop;
};

export type StopDecision = 'skip' | 'refresh' | 'exhaust' | 'clear';

export type RetentionRunResult = {
  status: 'overlap' | 'locked' | 'lost-lease' | 'finished';
  refreshed: number;
  cleared: number;
  refreshFailed: number;
};

export function retentionSchedule(env: NodeJS.ProcessEnv): { enabled: boolean; intervalMs: number } {
  const requested = Number(env.COORDINATE_RETENTION_INTERVAL_SECONDS);
  const seconds = Number.isFinite(requested) && requested > 0 ? requested : 3600;
  const clamped = Math.min(COORDINATE_RETENTION_MAX_INTERVAL_MS / 1000, Math.max(60, Math.floor(seconds)));
  return {
    enabled: env.COORDINATE_RETENTION_ENABLED === 'true',
    intervalMs: clamped * 1000,
  };
}

export function isActiveDeliveryStatus(status: DeliveryStatus): boolean {
  return ACTIVE.has(status);
}

export function isTerminalDeliveryStatus(status: DeliveryStatus): boolean {
  return (TERMINAL_DELIVERY_STATUSES as readonly DeliveryStatus[]).includes(status);
}

export function storageDeadline(clockStart: Date): number {
  return clockStart.getTime() + COORDINATE_RETENTION_MS - COORDINATE_DELETION_BUFFER_MS;
}

export function shouldWithholdCoordinates(
  status: DeliveryStatus,
  createdAt: Date | string | null | undefined,
  stop: Partial<StoredStop> | null | undefined,
  now: Date,
): boolean {
  if (!stop?.source || createdAt == null) {
    return false;
  }
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(created.getTime())) {
    return false;
  }
  return decideStop(status, created, {
    source: stop.source,
    placeId: stop.placeId ?? null,
    latitude: stop.latitude ?? null,
    longitude: stop.longitude ?? null,
    retrievedAt: stop.retrievedAt ?? null,
    refreshAttemptedAt: stop.refreshAttemptedAt ?? null,
  }, now) === 'clear';
}

export function unreviewedClock(createdAt: Date, retrievedAt: Date | null): Date {
  if (retrievedAt && retrievedAt.getTime() < createdAt.getTime()) {
    return retrievedAt;
  }
  return createdAt;
}

export function decideStop(
  status: DeliveryStatus,
  createdAt: Date,
  stop: StoredStop,
  now: Date,
): StopDecision {
  if (stop.latitude === null && stop.longitude === null) {
    return 'skip';
  }
  if (stop.latitude === null || stop.longitude === null) {
    return stop.source === CoordinateSource.DEVICE_GEOCODER ? 'skip' : 'clear';
  }
  if (stop.source === CoordinateSource.DEVICE_GEOCODER) {
    return 'skip';
  }
  if (stop.source === CoordinateSource.UNREVIEWED) {
    const deadline = storageDeadline(unreviewedClock(createdAt, stop.retrievedAt));
    return now.getTime() >= deadline ? 'clear' : 'skip';
  }
  if (stop.source !== CoordinateSource.GOOGLE_PLACES) {
    return 'skip';
  }
  if (!stop.retrievedAt) {
    return 'clear';
  }
  const deadline = storageDeadline(stop.retrievedAt);
  if (now.getTime() >= deadline) {
    return 'clear';
  }
  const leadOpens = deadline - COORDINATE_REFRESH_LEAD_MS;
  if (now.getTime() < leadOpens) {
    return 'skip';
  }
  if (!isActiveDeliveryStatus(status) || stop.refreshAttemptedAt) {
    return 'skip';
  }
  if (!stop.placeId || !isPlaceId(stop.placeId)) {
    return 'exhaust';
  }
  return 'refresh';
}

export function isActionable(delivery: StoredRetentionDelivery, now: Date): boolean {
  return decideStop(delivery.status, delivery.createdAt, delivery.pickup, now) !== 'skip'
    || decideStop(delivery.status, delivery.createdAt, delivery.dropoff, now) !== 'skip';
}

export interface RetentionStore {
  claim(owner: string, now: Date, leaseMs: number): Promise<boolean>;
  renew(owner: string, now: Date, leaseMs: number): Promise<boolean>;
  release(owner: string): Promise<void>;
  listCandidates(now: Date): Promise<StoredRetentionDelivery[]>;
  clearCoordinates(id: string, side: StopSide, expected: StoredStop): Promise<boolean>;
  recordRefreshFailure(id: string, side: StopSide, expected: StoredStop, attemptedAt: Date): Promise<boolean>;
  saveRefresh(
    id: string,
    side: StopSide,
    expected: StoredStop,
    latitude: string,
    longitude: string,
    retrievedAt: Date,
  ): Promise<boolean>;
}

export async function runRetention(
  store: RetentionStore,
  refreshLocation: (placeId: string) => Promise<{ latitude: number; longitude: number }>,
  now: Date,
  clock: () => Date = () => now,
  log: (message: string) => void = () => undefined,
  owner = randomUUID(),
): Promise<RetentionRunResult> {
  const result: RetentionRunResult = { status: 'finished', refreshed: 0, cleared: 0, refreshFailed: 0 };
  const claimed = await store.claim(owner, clock(), COORDINATE_RETENTION_LEASE_MS);
  if (!claimed) {
    result.status = 'locked';
    log('Coordinate retention skipped because another pass holds the lock');
    return result;
  }
  try {
    const candidates = await store.listCandidates(now);
    let due = candidates.filter((delivery) => isActionable(delivery, now)).slice(0, COORDINATE_RETENTION_BATCH);
    for (let batch = 0; batch < RETENTION_DRAIN_LIMIT && due.length > 0; batch += 1) {
      for (const delivery of due) {
        if (!await store.renew(owner, clock(), COORDINATE_RETENTION_LEASE_MS)) {
          result.status = 'lost-lease';
          log('Coordinate retention stopped because the lock lease was lost');
          return result;
        }
        for (const side of ['pickup', 'dropoff'] as const) {
          const outcome = await applyStop(store, refreshLocation, delivery, side, now, clock, log);
          result.refreshed += outcome.refreshed;
          result.cleared += outcome.cleared;
          result.refreshFailed += outcome.refreshFailed;
        }
      }
      if (due.length < COORDINATE_RETENTION_BATCH) {
        break;
      }
      const next = await store.listCandidates(now);
      due = next.filter((delivery) => isActionable(delivery, now)).slice(0, COORDINATE_RETENTION_BATCH);
      if (batch === RETENTION_DRAIN_LIMIT - 1 && due.length > 0) {
        log('Coordinate retention stopped with deliveries still due');
      }
    }
    log(`Coordinate retention finished refreshed=${result.refreshed} cleared=${result.cleared} refreshFailed=${result.refreshFailed}`);
    return result;
  } finally {
    await store.release(owner);
  }
}

async function applyStop(
  store: RetentionStore,
  refreshLocation: (placeId: string) => Promise<{ latitude: number; longitude: number }>,
  delivery: StoredRetentionDelivery,
  side: StopSide,
  now: Date,
  clock: () => Date,
  log: (message: string) => void,
): Promise<Pick<RetentionRunResult, 'refreshed' | 'cleared' | 'refreshFailed'>> {
  const stop = delivery[side];
  const decision = decideStop(delivery.status, delivery.createdAt, stop, now);
  if (decision === 'skip') {
    return { refreshed: 0, cleared: 0, refreshFailed: 0 };
  }
  if (decision === 'clear') {
    const cleared = await store.clearCoordinates(delivery.id, side, stop);
    if (cleared) {
      log(`Coordinate retention cleared deliveryId=${delivery.id} stop=${side}`);
    }
    return { refreshed: 0, cleared: cleared ? 1 : 0, refreshFailed: 0 };
  }
  if (decision === 'exhaust') {
    const recorded = await store.recordRefreshFailure(delivery.id, side, stop, clock());
    if (recorded) {
      log(`Coordinate retention refresh failed deliveryId=${delivery.id} stop=${side} reason=place-id`);
    }
    return { refreshed: 0, cleared: 0, refreshFailed: recorded ? 1 : 0 };
  }
  const deadline = stop.retrievedAt ? storageDeadline(stop.retrievedAt) : now.getTime();
  if (clock().getTime() >= deadline) {
    const cleared = await store.clearCoordinates(delivery.id, side, stop);
    if (cleared) {
      log(`Coordinate retention cleared deliveryId=${delivery.id} stop=${side}`);
    }
    return { refreshed: 0, cleared: cleared ? 1 : 0, refreshFailed: 0 };
  }
  try {
    const placeId = stop.placeId ?? '';
    const point = await refreshLocation(placeId);
    if (clock().getTime() >= deadline) {
      const cleared = await store.clearCoordinates(delivery.id, side, stop);
      if (cleared) {
        log(`Coordinate retention cleared deliveryId=${delivery.id} stop=${side}`);
      }
      return { refreshed: 0, cleared: cleared ? 1 : 0, refreshFailed: 0 };
    }
    const saved = await store.saveRefresh(
      delivery.id,
      side,
      stop,
      point.latitude.toFixed(7),
      point.longitude.toFixed(7),
      clock(),
    );
    if (saved) {
      log(`Coordinate retention refreshed deliveryId=${delivery.id} stop=${side}`);
      return { refreshed: 1, cleared: 0, refreshFailed: 0 };
    }
    return { refreshed: 0, cleared: 0, refreshFailed: 0 };
  } catch (error) {
    const reason = error instanceof Error ? error.name : 'Error';
    if (clock().getTime() >= deadline) {
      const cleared = await store.clearCoordinates(delivery.id, side, stop);
      if (cleared) {
        log(`Coordinate retention cleared deliveryId=${delivery.id} stop=${side}`);
      }
      return { refreshed: 0, cleared: cleared ? 1 : 0, refreshFailed: 0 };
    }
    const recorded = await store.recordRefreshFailure(delivery.id, side, stop, clock());
    if (recorded) {
      log(`Coordinate retention refresh failed deliveryId=${delivery.id} stop=${side} reason=${reason}`);
    }
    return { refreshed: 0, cleared: 0, refreshFailed: recorded ? 1 : 0 };
  }
}
