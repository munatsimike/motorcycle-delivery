import { describe, expect, it } from 'vitest';
import { CoordinateSource, DeliveryStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CoordinateRetentionService } from './coordinate-retention.service.js';
import {
  ACTIVE_DELIVERY_STATUSES,
  COORDINATE_DELETION_BUFFER_MS,
  COORDINATE_RETENTION_MS,
  TERMINAL_DELIVERY_STATUSES,
  retentionSchedule,
  runRetention,
  storageDeadline,
  type RetentionStore,
  type StopSide,
  type StoredRetentionDelivery,
  type StoredStop,
} from './coordinate-retention.js';

const PLACE_ID = 'ChIJstreet0001';
const LATITUDE = '-17.8292123';
const LONGITUDE = '31.0522123';
const NOW = new Date('2026-10-18T12:00:00.000Z');

describe('coordinate retention', () => {
  it('uses every backend delivery status as active or terminal', () => {
    const statuses = Object.values(DeliveryStatus);
    expect(new Set([...ACTIVE_DELIVERY_STATUSES, ...TERMINAL_DELIVERY_STATUSES])).toEqual(new Set(statuses));
    expect(ACTIVE_DELIVERY_STATUSES).toContain(DeliveryStatus.NO_RIDER_FOUND);
    expect(ACTIVE_DELIVERY_STATUSES).toContain(DeliveryStatus.ARRIVED_AT_DROPOFF);
    expect(TERMINAL_DELIVERY_STATUSES).toEqual([
      DeliveryStatus.DELIVERED,
      DeliveryStatus.CANCELLED,
      DeliveryStatus.FAILED,
    ]);
  });

  it('clears expired Google coordinates for a terminal delivery and does nothing on the next pass', async () => {
    const store = memory([delivery(DeliveryStatus.DELIVERED, daysAgo(31))]);
    const logs: string[] = [];
    const first = await runRetention(store, unexpectedRefresh, NOW, () => NOW, logs.push.bind(logs));
    expect(first).toMatchObject({ status: 'finished', cleared: 2, refreshed: 0, refreshFailed: 0 });
    expect(store.rows[0]?.pickup.latitude).toBeNull();
    expect(store.rows[0]?.dropoff.longitude).toBeNull();
    expect(store.rows[0]?.pickup.retrievedAt?.toISOString()).toBe(daysAgo(31).toISOString());
    const second = await runRetention(store, unexpectedRefresh, NOW, () => NOW);
    expect(second.cleared).toBe(0);
    expect(store.rows[0]?.pickup.placeId).toBe(PLACE_ID);
    expect(logs.join('\n')).not.toContain(LATITUDE);
    expect(logs.join('\n')).not.toContain('test-maps-key');
  });

  it('refreshes an active delivery once before the deadline and keeps the new retrieval time', async () => {
    const calls: string[] = [];
    const store = memory([delivery(DeliveryStatus.SEARCHING, daysAgo(29.5))]);
    const clock = { time: NOW };
    const first = await runRetention(store, async (placeId) => {
      calls.push(placeId);
      return { latitude: -17.1, longitude: 31.1 };
    }, NOW, () => clock.time);
    expect(first).toMatchObject({ refreshed: 2, cleared: 0, refreshFailed: 0 });
    expect(calls).toEqual([PLACE_ID, PLACE_ID]);
    expect(store.rows[0]?.pickup.latitude).toBe('-17.1000000');
    expect(store.rows[0]?.pickup.retrievedAt?.toISOString()).toBe(NOW.toISOString());
    const second = await runRetention(store, async () => {
      calls.push('again');
      return { latitude: 0, longitude: 0 };
    }, NOW, () => clock.time);
    expect(second.refreshed).toBe(0);
    expect(calls).toEqual([PLACE_ID, PLACE_ID]);
  });

  it('does not move the deadline when a refresh fails, then clears the active delivery after 30 days', async () => {
    const retrievedAt = daysAgo(29.5);
    const store = memory([delivery(DeliveryStatus.ASSIGNED, retrievedAt)]);
    let calls = 0;
    const failed = await runRetention(store, async () => {
      calls += 1;
      throw new Error('Places failed');
    }, NOW, () => NOW);
    expect(failed).toMatchObject({ refreshFailed: 2, cleared: 0, refreshed: 0 });
    expect(store.rows[0]?.pickup.latitude).toBe(LATITUDE);
    expect(store.rows[0]?.pickup.retrievedAt?.toISOString()).toBe(retrievedAt.toISOString());
    expect(store.rows[0]?.pickup.refreshAttemptedAt?.toISOString()).toBe(NOW.toISOString());
    const repeated = await runRetention(store, async () => {
      calls += 1;
      throw new Error('Places failed');
    }, NOW, () => NOW);
    expect(repeated.refreshFailed).toBe(0);
    expect(calls).toBe(2);
    const expired = new Date(retrievedAt.getTime() + COORDINATE_RETENTION_MS + 1000);
    const cleared = await runRetention(store, unexpectedRefresh, expired, () => expired);
    expect(cleared).toMatchObject({ cleared: 2, refreshed: 0 });
    expect(store.rows[0]?.pickup.latitude).toBeNull();
    expect(store.rows[0]?.pickup.retrievedAt?.toISOString()).toBe(retrievedAt.toISOString());
  });

  it('discards a refresh that returns after the deletion buffer', async () => {
    const retrievedAt = new Date(NOW.getTime() - COORDINATE_RETENTION_MS + COORDINATE_DELETION_BUFFER_MS);
    const bufferedDeadline = storageDeadline(retrievedAt);
    const store = memory([delivery(DeliveryStatus.IN_TRANSIT, retrievedAt)]);
    const clock = { time: new Date(bufferedDeadline - 60_000) };
    const result = await runRetention(store, async () => {
      clock.time = new Date(bufferedDeadline + 1000);
      return { latitude: -17.2, longitude: 31.2 };
    }, clock.time, () => clock.time);
    expect(result).toMatchObject({ cleared: 2, refreshed: 0 });
    expect(store.rows[0]?.pickup.latitude).toBeNull();
    expect(store.rows[0]?.pickup.retrievedAt?.toISOString()).toBe(retrievedAt.toISOString());
    expect(bufferedDeadline).toBeLessThan(retrievedAt.getTime() + COORDINATE_RETENTION_MS);
  });

  it('leaves a terminal delivery untouched until the deadline and then clears it', async () => {
    const store = memory([delivery(DeliveryStatus.CANCELLED, daysAgo(29.5))]);
    const waiting = await runRetention(store, unexpectedRefresh, NOW, () => NOW);
    expect(waiting.cleared).toBe(0);
    expect(waiting.refreshed).toBe(0);
    expect(store.rows[0]?.dropoff.latitude).toBe(LATITUDE);
    const expired = await runRetention(store, unexpectedRefresh, daysFrom(NOW, 2), () => daysFrom(NOW, 2));
    expect(expired.cleared).toBe(2);
  });

  it('clears unreviewed rows from created_at, and earlier when a retrieval time exists', async () => {
    const recent = delivery(DeliveryStatus.NO_RIDER_FOUND, NOW);
    recent.createdAt = daysAgo(10);
    recent.pickup = unreviewed(LATITUDE);
    recent.dropoff = unreviewed(LONGITUDE);
    const old = delivery(DeliveryStatus.FAILED, NOW);
    old.id = 'old-unreviewed';
    old.createdAt = daysAgo(31);
    old.pickup = unreviewed(LATITUDE);
    old.dropoff = unreviewed(LONGITUDE);
    const evidenced = delivery(DeliveryStatus.DELIVERED, NOW);
    evidenced.id = 'earlier-google';
    evidenced.createdAt = daysAgo(10);
    evidenced.pickup = { ...unreviewed(LATITUDE), retrievedAt: daysAgo(40), placeId: PLACE_ID };
    evidenced.dropoff = unreviewed(LONGITUDE);
    const labeled = delivery(DeliveryStatus.CREATED, NOW);
    labeled.id = 'place-id-only';
    labeled.createdAt = daysAgo(10);
    labeled.pickup = { ...unreviewed(LATITUDE), placeId: PLACE_ID };
    labeled.dropoff = unreviewed(LONGITUDE);
    const store = memory([recent, old, evidenced, labeled]);
    const result = await runRetention(store, unexpectedRefresh, NOW, () => NOW);
    expect(result.cleared).toBe(3);
    expect(store.rows[0]?.pickup.latitude).toBe(LATITUDE);
    expect(store.rows[1]?.pickup.latitude).toBeNull();
    expect(store.rows[1]?.dropoff.latitude).toBeNull();
    expect(store.rows[2]?.pickup.latitude).toBeNull();
    expect(store.rows[2]?.dropoff.latitude).toBe(LONGITUDE);
    expect(store.rows[3]?.pickup.latitude).toBe(LATITUDE);
  });

  it('does not clear device geocoder coordinates', async () => {
    const row = delivery(DeliveryStatus.DELIVERED, daysAgo(400));
    row.pickup = { ...row.pickup, source: CoordinateSource.DEVICE_GEOCODER, placeId: null };
    row.dropoff = { ...row.dropoff, source: CoordinateSource.DEVICE_GEOCODER, placeId: null };
    const store = memory([row]);
    const result = await runRetention(store, unexpectedRefresh, NOW, () => NOW);
    expect(result.cleared).toBe(0);
    expect(store.rows[0]?.pickup.latitude).toBe(LATITUDE);
  });

  it('skips a second pass while the lock is held and stops when the lease is lost', async () => {
    const store = memory([
      delivery(DeliveryStatus.DELIVERED, daysAgo(31)),
      { ...delivery(DeliveryStatus.FAILED, daysAgo(31)), id: 'second' },
    ]);
    store.failRenewAfter = 1;
    const lost = await runRetention(store, unexpectedRefresh, NOW, () => NOW, () => undefined, 'owner-a');
    expect(lost.status).toBe('lost-lease');
    expect(store.rows[0]?.pickup.latitude).toBeNull();
    expect(store.rows[1]?.pickup.latitude).toBe(LATITUDE);
    store.lock = { owner: 'owner-b', until: NOW.getTime() + 60_000 };
    const blocked = await runRetention(store, unexpectedRefresh, NOW, () => NOW, () => undefined, 'owner-a');
    expect(blocked.status).toBe('locked');
    expect(store.rows[1]?.pickup.latitude).toBe(LATITUDE);
  });

  it('clears Google coordinates before the hard 30-day limit by at least one hourly gap', async () => {
    const maxGap = retentionSchedule({
      COORDINATE_RETENTION_ENABLED: 'true',
      COORDINATE_RETENTION_INTERVAL_SECONDS: '999999',
    }).intervalMs;
    expect(COORDINATE_DELETION_BUFFER_MS).toBeGreaterThanOrEqual(maxGap);
    const retrievedAt = new Date(NOW.getTime() - (COORDINATE_RETENTION_MS - COORDINATE_DELETION_BUFFER_MS) - 1000);
    const hardDeadline = retrievedAt.getTime() + COORDINATE_RETENTION_MS;
    expect(NOW.getTime()).toBeLessThan(hardDeadline);
    const store = memory([delivery(DeliveryStatus.SEARCHING, retrievedAt)]);
    const cleared = await runRetention(store, unexpectedRefresh, NOW, () => NOW);
    expect(cleared.cleared).toBe(2);
    expect(cleared.refreshed).toBe(0);
    const lastSkip = storageDeadline(retrievedAt) - 1;
    const nextRun = lastSkip + maxGap;
    expect(nextRun).toBeLessThan(hardDeadline);
    const waiting = memory([delivery(DeliveryStatus.SEARCHING, retrievedAt)]);
    const beforeBuffer = await runRetention(waiting, unexpectedRefresh, new Date(lastSkip), () => new Date(lastSkip));
    expect(beforeBuffer.cleared).toBe(0);
    expect(waiting.rows[0]?.pickup.latitude).toBe(LATITUDE);
  });

  it('enables the schedule only for the exact true flag and clamps the interval', () => {
    expect(retentionSchedule({}).enabled).toBe(false);
    expect(retentionSchedule({ COORDINATE_RETENTION_ENABLED: 'false' }).enabled).toBe(false);
    expect(retentionSchedule({ COORDINATE_RETENTION_ENABLED: 'TRUE' }).enabled).toBe(false);
    expect(retentionSchedule({ COORDINATE_RETENTION_ENABLED: 'true' })).toMatchObject({ enabled: true, intervalMs: 3_600_000 });
    expect(retentionSchedule({ COORDINATE_RETENTION_ENABLED: 'true', COORDINATE_RETENTION_INTERVAL_SECONDS: '1' }).intervalMs).toBe(60_000);
    expect(retentionSchedule({ COORDINATE_RETENTION_ENABLED: 'true', COORDINATE_RETENTION_INTERVAL_SECONDS: '999999' }).intervalMs).toBe(6 * 60 * 60 * 1000);
  });

  it('ignores an overlapping call in the same process', async () => {
    let release: (value: { count: number }) => void = () => undefined;
    const gate = new Promise<{ count: number }>((resolve) => {
      release = resolve;
    });
    const service = new CoordinateRetentionService({
      coordinateRetentionLock: { updateMany: () => gate },
    } as unknown as PrismaService);
    const first = service.run(NOW);
    const second = await service.run(NOW);
    expect(second.status).toBe('overlap');
    release({ count: 0 });
    await expect(first).resolves.toMatchObject({ status: 'locked' });
  });
});

function unexpectedRefresh(): Promise<{ latitude: number; longitude: number }> {
  return Promise.reject(new Error('refresh was not expected'));
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function daysFrom(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function delivery(status: DeliveryStatus, retrievedAt: Date): StoredRetentionDelivery {
  return {
    id: 'delivery-1',
    status,
    createdAt: retrievedAt,
    pickup: googleStop(retrievedAt),
    dropoff: googleStop(retrievedAt),
  };
}

function googleStop(retrievedAt: Date): StoredStop {
  return {
    source: CoordinateSource.GOOGLE_PLACES,
    placeId: PLACE_ID,
    latitude: LATITUDE,
    longitude: LONGITUDE,
    retrievedAt,
    refreshAttemptedAt: null,
  };
}

function unreviewed(latitude: string): StoredStop {
  return {
    source: CoordinateSource.UNREVIEWED,
    placeId: null,
    latitude,
    longitude: LONGITUDE,
    retrievedAt: null,
    refreshAttemptedAt: null,
  };
}

class MemoryStore implements RetentionStore {
  lock: { owner: string; until: number } | null = null;
  renews = 0;
  failRenewAfter = Number.POSITIVE_INFINITY;

  constructor(readonly rows: StoredRetentionDelivery[]) {}

  async claim(owner: string, now: Date, leaseMs: number): Promise<boolean> {
    if (this.lock && this.lock.until > now.getTime()) {
      return false;
    }
    this.lock = { owner, until: now.getTime() + leaseMs };
    return true;
  }

  async renew(owner: string, now: Date, leaseMs: number): Promise<boolean> {
    this.renews += 1;
    if (this.renews > this.failRenewAfter || !this.lock || this.lock.owner !== owner) {
      return false;
    }
    this.lock = { owner, until: now.getTime() + leaseMs };
    return true;
  }

  async release(owner: string): Promise<void> {
    if (this.lock?.owner === owner) {
      this.lock = null;
    }
  }

  async listCandidates(): Promise<StoredRetentionDelivery[]> {
    return this.rows.map((row) => ({
      ...row,
      pickup: { ...row.pickup },
      dropoff: { ...row.dropoff },
    }));
  }

  async clearCoordinates(id: string, side: StopSide, expected: StoredStop): Promise<boolean> {
    const stop = this.match(id, side, expected);
    if (!stop || (stop.latitude === null && stop.longitude === null)) {
      return false;
    }
    stop.latitude = null;
    stop.longitude = null;
    return true;
  }

  async recordRefreshFailure(id: string, side: StopSide, expected: StoredStop, attemptedAt: Date): Promise<boolean> {
    const stop = this.match(id, side, expected);
    if (!stop || stop.refreshAttemptedAt || (stop.latitude === null && stop.longitude === null)) {
      return false;
    }
    stop.refreshAttemptedAt = attemptedAt;
    return true;
  }

  async saveRefresh(
    id: string,
    side: StopSide,
    expected: StoredStop,
    latitude: string,
    longitude: string,
    retrievedAt: Date,
  ): Promise<boolean> {
    const stop = this.match(id, side, expected);
    if (!stop || stop.latitude === null || stop.longitude === null) {
      return false;
    }
    stop.latitude = latitude;
    stop.longitude = longitude;
    stop.retrievedAt = retrievedAt;
    stop.refreshAttemptedAt = null;
    return true;
  }

  private match(id: string, side: StopSide, expected: StoredStop): StoredStop | null {
    const row = this.rows.find((item) => item.id === id);
    const stop = row?.[side];
    if (!stop || stop.source !== expected.source || !sameTime(stop.retrievedAt, expected.retrievedAt)) {
      return null;
    }
    return stop;
  }
}

function memory(rows: StoredRetentionDelivery[]): MemoryStore {
  return new MemoryStore(rows);
}

function sameTime(left: Date | null, right: Date | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.getTime() === right.getTime();
}
