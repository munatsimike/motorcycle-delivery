import { describe, expect, it } from 'vitest';

import {
  confirmCustomerIdentity,
  customerIdForSession,
  rebindCustomerIdentity,
  sessionKeyForRefreshToken,
} from '../../../services/session/customerIdentity';
import type { CustomerDelivery } from './deliveryStatus';
import {
  applyDeliveryRefresh,
  commitSyncGeneration,
  deliveryListFailure,
  issueSyncGeneration,
  readRecentDeliverySnapshot,
  savedDeliveryMessage,
  shouldRefreshDeliveriesOnForeground,
  shouldRefreshSavedDeliveries,
  snapshotFromDeliveries,
  type SyncClock,
} from './recentDeliveryCache';
import {
  createCustomerIdentityPersistence,
  createRecentDeliveryPersistence,
  type KeyValueStore,
} from './recentDeliveryPersistence';

function delivery(id: string, status: CustomerDelivery['status'] = 'SEARCHING'): CustomerDelivery {
  return {
    id,
    status,
    createdAt: `2026-10-18T1${id}:00:00.000Z`,
    pickupAddress: `${id} pickup`,
    dropoffAddress: `${id} dropoff`,
  };
}

function deliveries(count: number): CustomerDelivery[] {
  return Array.from({ length: count }, (_, index) => delivery(String(index + 1)));
}

function memoryStore(): KeyValueStore {
  const values = new Map<string, string>();
  return {
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    async deleteItem(key) {
      values.delete(key);
    },
  };
}

describe('recent delivery cache', () => {
  it('saves five deliveries from a successful fetch', () => {
    const snapshot = snapshotFromDeliveries('customer-a', deliveries(5), '2026-10-18T12:00:00.000Z', 1);
    expect(snapshot?.deliveries).toHaveLength(5);
    expect(snapshot?.deliveries.map((item) => item.id)).toEqual(['1', '2', '3', '4', '5']);
    expect(snapshot?.deliveries[0]).toEqual({
      id: '1',
      status: 'SEARCHING',
      createdAt: '2026-10-18T11:00:00.000Z',
      pickupAddress: '1 pickup',
      dropoffAddress: '1 dropoff',
      serviceClass: null,
      deliverBy: null,
      currency: null,
      suggestedPrice: null,
      offeredPrice: null,
      distanceMeters: null,
      parcelDescription: null,
    });
  });

  it('keeps the first five deliveries in backend order', () => {
    const snapshot = snapshotFromDeliveries('customer-a', deliveries(6), '2026-10-18T12:00:00.000Z', 1);
    expect(snapshot?.deliveries.map((item) => item.id)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('drops duplicate delivery ids', () => {
    const snapshot = snapshotFromDeliveries(
      'customer-a',
      [delivery('1'), delivery('1', 'DELIVERED'), delivery('2')],
      '2026-10-18T12:00:00.000Z',
      1,
    );
    expect(snapshot?.deliveries.map((item) => item.status)).toEqual(['SEARCHING', 'SEARCHING']);
    expect(snapshot?.deliveries.map((item) => item.id)).toEqual(['1', '2']);
  });

  it('loads the saved deliveries from a new store reader', async () => {
    const store = memoryStore();
    const writer = createRecentDeliveryPersistence(store);
    const snapshot = snapshotFromDeliveries('customer-a', deliveries(2), '2026-10-18T12:00:00.000Z', 3);
    await writer.save(snapshot!);
    const reader = createRecentDeliveryPersistence(store);
    expect(await reader.load('customer-a')).toEqual(snapshot);
  });

  it('keeps the saved deliveries when a refresh fails', () => {
    const current = snapshotFromDeliveries('customer-a', deliveries(2), '2026-10-18T12:00:00.000Z', 2);
    expect(applyDeliveryRefresh(current, {
      customerId: 'customer-a',
      deliveries: null,
      savedAt: '2026-10-18T13:00:00.000Z',
      syncGeneration: 3,
    })).toBe('keep');
  });

  it('clears the saved deliveries after a successful empty response', () => {
    const current = snapshotFromDeliveries('customer-a', deliveries(2), '2026-10-18T12:00:00.000Z', 2);
    expect(applyDeliveryRefresh(current, {
      customerId: 'customer-a',
      deliveries: [],
      savedAt: '2026-10-18T13:00:00.000Z',
      syncGeneration: 3,
    })).toBeNull();
  });

  it('does not read another customer snapshot', async () => {
    const store = memoryStore();
    const persistence = createRecentDeliveryPersistence(store);
    await persistence.save(snapshotFromDeliveries('customer-a', deliveries(1), '2026-10-18T12:00:00.000Z', 1)!);
    expect(await persistence.load('customer-b')).toBeNull();
    expect((await persistence.load('customer-a'))?.deliveries).toHaveLength(1);
  });

  it('clears the previous customer when a different account is confirmed', async () => {
    const store = memoryStore();
    const deliveriesStore = createRecentDeliveryPersistence(store);
    const identities = createCustomerIdentityPersistence(store);
    await deliveriesStore.save(snapshotFromDeliveries('customer-a', deliveries(1), '2026-10-18T12:00:00.000Z', 1)!);
    const first = confirmCustomerIdentity(null, 'customer-a', 'refresh-a');
    await identities.save(first!.identity);
    const second = confirmCustomerIdentity(await identities.load(), 'customer-b', 'refresh-b');
    expect(second?.replacedCustomerId).toBe('customer-a');
    await deliveriesStore.clear(second!.replacedCustomerId!);
    await identities.save(second!.identity);
    expect(await deliveriesStore.load('customer-a')).toBeNull();
    expect(customerIdForSession(await identities.load(), 'refresh-b')).toBe('customer-b');
    expect(customerIdForSession(await identities.load(), 'refresh-a')).toBeNull();
  });

  it('removes saved deliveries on logout and does not restore them for the next session key', async () => {
    const store = memoryStore();
    const deliveriesStore = createRecentDeliveryPersistence(store);
    const identities = createCustomerIdentityPersistence(store);
    await deliveriesStore.save(snapshotFromDeliveries('customer-a', deliveries(1), '2026-10-18T12:00:00.000Z', 1)!);
    await identities.save(confirmCustomerIdentity(null, 'customer-a', 'refresh-a')!.identity);
    await deliveriesStore.clear('customer-a');
    await identities.clear();
    expect(await deliveriesStore.load('customer-a')).toBeNull();
    expect(customerIdForSession(await identities.load(), 'refresh-a')).toBeNull();
  });

  it('ignores a corrupt or outdated cache', async () => {
    const store = memoryStore();
    const persistence = createRecentDeliveryPersistence(store);
    await store.setItem('riders.customer.deliveries.customer-a', JSON.stringify({ parts: 1 }));
    await store.setItem('riders.customer.deliveries.customer-a.0', JSON.stringify({
      schemaVersion: 0,
      customerId: 'customer-a',
      savedAt: '2026-10-18T12:00:00.000Z',
      syncGeneration: 1,
      deliveries: [],
    }));
    expect(await persistence.load('customer-a')).toBeNull();
    expect(readRecentDeliverySnapshot({ schemaVersion: 1, customerId: 'customer-a' }, 'customer-a')).toBeNull();
  });

  it('replaces the cache when a later refresh succeeds', () => {
    const current = snapshotFromDeliveries('customer-a', [delivery('1', 'SEARCHING')], '2026-10-18T12:00:00.000Z', 1);
    const next = applyDeliveryRefresh(current, {
      customerId: 'customer-a',
      deliveries: [delivery('1', 'DELIVERED')],
      savedAt: '2026-10-18T13:00:00.000Z',
      syncGeneration: 2,
    });
    expect(next).not.toBe('keep');
    expect(next && next !== 'keep' ? next.deliveries[0]?.status : null).toBe('DELIVERED');
    expect(shouldRefreshSavedDeliveries('active', true)).toBe(true);
    expect(shouldRefreshSavedDeliveries('background', true)).toBe(false);
    expect(shouldRefreshSavedDeliveries('active', false)).toBe(false);
    expect(shouldRefreshDeliveriesOnForeground('active', true)).toBe(true);
    expect(shouldRefreshDeliveriesOnForeground('background', true)).toBe(false);
    expect(shouldRefreshDeliveriesOnForeground('active', false)).toBe(false);
  });

  it('does not let an older response overwrite a newer snapshot', () => {
    const clock: SyncClock = { issued: 0, committed: 0 };
    const first = issueSyncGeneration(clock);
    const second = issueSyncGeneration(clock);
    expect(commitSyncGeneration(clock, second)).toBe(true);
    expect(commitSyncGeneration(clock, first)).toBe(false);
    const current = snapshotFromDeliveries('customer-a', [delivery('2')], '2026-10-18T13:00:00.000Z', second);
    expect(applyDeliveryRefresh(current, {
      customerId: 'customer-a',
      deliveries: [delivery('1')],
      savedAt: '2026-10-18T12:00:00.000Z',
      syncGeneration: first,
    })).toBe('keep');
  });

  it('describes saved statuses as previously saved', () => {
    const savedAt = '2026-10-18T13:23:00.000Z';
    const message = savedDeliveryMessage(savedAt);
    const date = new Date(savedAt);
    expect(message).toContain('Last updated');
    expect(message).not.toContain('Saved on this phone');
    expect(message).toContain('Statuses may have changed');
    expect(message).toContain(String(date.getDate()));
    expect(savedDeliveryMessage('not-a-date')).toBeNull();
    expect(deliveryListFailure({ status: 401 })).toBe('authentication');
    expect(deliveryListFailure(new Error('Network request failed. Check your connection and try again.'))).toBe('unavailable');
    expect(sessionKeyForRefreshToken('refresh-a')).not.toContain('refresh-a');
    expect(rebindCustomerIdentity(
      confirmCustomerIdentity(null, 'customer-a', 'refresh-a')!.identity,
      'refresh-a',
      'refresh-a-next',
    )?.sessionKey).toBe(sessionKeyForRefreshToken('refresh-a-next'));
  });
});
