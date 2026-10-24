import { describe, expect, it } from 'vitest';

import type { CustomerDeliveryDetail } from './customerDeliveryDetail';
import { createDeliveryTracker, TRACKING_POLL_MS, type TrackingClock } from './deliveryTracking';

function delivery(
  status: CustomerDeliveryDetail['status'],
  id = 'delivery-1',
  extra: Partial<CustomerDeliveryDetail> = {},
): CustomerDeliveryDetail {
  return {
    id,
    status,
    currency: 'USD',
    offeredPrice: '4.50',
    suggestedPrice: '4.50',
    serviceClass: null,
    deliverBy: null,
    distanceMeters: 100,
    pickupAddress: 'Pickup',
    pickupLatitude: -17.8292,
    pickupLongitude: 31.0522,
    dropoffAddress: 'Drop-off',
    dropoffLatitude: -17.825,
    dropoffLongitude: 31.033,
    parcelDescription: 'Documents',
    createdAt: null,
    riderLocation: null,
    ...extra,
  };
}

function clock() {
  let pending: { callback: () => void; delayMs: number } | null = null;
  const tracking: TrackingClock = {
    schedule(callback, delayMs) {
      pending = { callback, delayMs };
    },
    clear() {
      pending = null;
    },
  };
  return {
    tracking,
    pending: () => pending,
    fire() {
      const scheduled = pending;
      pending = null;
      scheduled?.callback();
    },
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('delivery tracking updates', () => {
  it('loads when the screen is focused and waits for a manual refresh', async () => {
    const timer = clock();
    const loads: Array<ReturnType<typeof deferred<CustomerDeliveryDetail>>> = [];
    const tracker = createDeliveryTracker({
      load: () => {
        const next = deferred<CustomerDeliveryDetail>();
        loads.push(next);
        return next.promise;
      },
      clock: timer.tracking,
      isAuthError: () => false,
      errorText: () => 'offline',
      onChange: () => undefined,
    });

    tracker.setFocused(true);
    expect(loads).toHaveLength(1);
    expect(timer.pending()).toBeNull();

    loads[0]?.resolve(delivery('SEARCHING'));
    await loads[0]?.promise;
    expect(timer.pending()).toBeNull();
    expect(loads).toHaveLength(1);

    tracker.refresh();
    expect(loads).toHaveLength(2);
  });

  it('does not start another request while one is still running', async () => {
    const timer = clock();
    const loads: Array<ReturnType<typeof deferred<CustomerDeliveryDetail>>> = [];
    const tracker = createDeliveryTracker({
      load: () => {
        const next = deferred<CustomerDeliveryDetail>();
        loads.push(next);
        return next.promise;
      },
      clock: timer.tracking,
      isAuthError: () => false,
      errorText: () => 'offline',
      onChange: () => undefined,
    });

    tracker.setFocused(true);
    tracker.refresh();
    timer.fire();
    expect(loads).toHaveLength(1);

    loads[0]?.resolve(delivery('CREATED'));
    await loads[0]?.promise;
    expect(timer.pending()).toBeNull();
  });

  it('stops away from the screen and refreshes when it returns', async () => {
    const timer = clock();
    const statuses: CustomerDeliveryDetail['status'][] = ['SEARCHING', 'ASSIGNED'];
    let calls = 0;
    const tracker = createDeliveryTracker({
      load: () => Promise.resolve(delivery(statuses[Math.min(calls++, statuses.length - 1)] ?? 'SEARCHING')),
      clock: timer.tracking,
      isAuthError: () => false,
      errorText: () => 'offline',
      onChange: () => undefined,
    });

    tracker.setFocused(true);
    await Promise.resolve();
    expect(timer.pending()).toBeNull();

    tracker.setFocused(false);
    expect(timer.pending()).toBeNull();
    timer.fire();
    expect(calls).toBe(1);

    tracker.setFocused(true);
    await Promise.resolve();
    expect(calls).toBe(2);
  });

  it('stops in the background and refreshes when the app returns', async () => {
    const timer = clock();
    let calls = 0;
    const tracker = createDeliveryTracker({
      load: () => {
        calls += 1;
        return Promise.resolve(delivery('IN_TRANSIT'));
      },
      clock: timer.tracking,
      isAuthError: () => false,
      errorText: () => 'offline',
      onChange: () => undefined,
    });

    tracker.setFocused(true);
    await Promise.resolve();
    tracker.setAppActive(false);
    expect(timer.pending()).toBeNull();

    tracker.setAppActive(true);
    await Promise.resolve();
    expect(calls).toBe(2);
    expect(timer.pending()).toBeNull();
  });

  it('stops polling a completed, cancelled, or failed delivery', async () => {
    for (const status of ['DELIVERED', 'CANCELLED', 'FAILED'] as const) {
      const timer = clock();
      const tracker = createDeliveryTracker({
        load: () => Promise.resolve(delivery(status)),
        clock: timer.tracking,
        isAuthError: () => false,
        errorText: () => 'offline',
        onChange: () => undefined,
      });
      tracker.setFocused(true);
      await Promise.resolve();
      expect(timer.pending()).toBeNull();
    }
  });

  it('keeps the last delivery when a later request fails and recovers on refresh', async () => {
    const timer = clock();
    const seen: Array<{ id: string; error: string | null }> = [];
    let calls = 0;
    const tracker = createDeliveryTracker({
      load: () => {
        calls += 1;
        if (calls === 2) {
          return Promise.reject(new Error('Network request failed. Check your connection and try again.'));
        }
        return Promise.resolve(delivery(calls === 1 ? 'SEARCHING' : 'ASSIGNED', `delivery-${calls}`));
      },
      clock: timer.tracking,
      isAuthError: () => false,
      errorText: (error) => (error instanceof Error ? error.message : 'offline'),
      onChange: (snapshot) => {
        if (snapshot.delivery || snapshot.error) {
          seen.push({ id: snapshot.delivery?.id ?? '', error: snapshot.error });
        }
      },
    });

    tracker.setFocused(true);
    await Promise.resolve();
    tracker.refresh();
    await Promise.resolve();
    tracker.refresh();
    await Promise.resolve();

    expect(seen).toEqual([
      { id: 'delivery-1', error: null },
      { id: 'delivery-1', error: 'Network request failed. Check your connection and try again.' },
      { id: 'delivery-3', error: null },
    ]);
  });

  it('does not repeat an error or keep polling after authentication fails', async () => {
    const timer = clock();
    const errors: string[] = [];
    let calls = 0;
    const tracker = createDeliveryTracker({
      load: () => {
        calls += 1;
        return Promise.reject(Object.assign(new Error('Sign in again.'), { status: 401 }));
      },
      clock: timer.tracking,
      isAuthError: (error) => error instanceof Error && 'status' in error && error.status === 401,
      errorText: () => 'Sign in again.',
      onChange: (snapshot) => {
        if (snapshot.error) {
          errors.push(snapshot.error);
        }
      },
    });

    tracker.setFocused(true);
    await Promise.resolve();
    timer.fire();

    expect(errors).toEqual(['Sign in again.']);
    expect(calls).toBe(1);
    expect(timer.pending()).toBeNull();
  });

  it('ignores a response that arrives after the screen is closed', async () => {
    const timer = clock();
    const pending = deferred<CustomerDeliveryDetail>();
    const seen: string[] = [];
    const tracker = createDeliveryTracker({
      load: () => pending.promise,
      clock: timer.tracking,
      isAuthError: () => false,
      errorText: () => 'offline',
      onChange: (snapshot) => {
        if (snapshot.delivery) {
          seen.push(snapshot.delivery.id);
        }
      },
    });

    tracker.setFocused(true);
    tracker.stop();
    pending.resolve(delivery('SEARCHING'));
    await pending.promise;
    expect(seen).toEqual([]);
    expect(timer.pending()).toBeNull();
  });

  it('refreshes immediately from the manual control', async () => {
    const timer = clock();
    let calls = 0;
    const tracker = createDeliveryTracker({
      load: () => {
        calls += 1;
        return Promise.resolve(delivery('SEARCHING'));
      },
      clock: timer.tracking,
      isAuthError: () => false,
      errorText: () => 'offline',
      onChange: () => undefined,
    });

    tracker.setFocused(true);
    await Promise.resolve();
    tracker.refresh();
    await Promise.resolve();
    expect(calls).toBe(2);
  });

  it('polls an active marketplace delivery and stops when it ends or the screen closes', async () => {
    const timer = clock();
    const statuses: CustomerDeliveryDetail['status'][] = ['COLLECTING', 'DELIVERED'];
    let calls = 0;
    const tracker = createDeliveryTracker({
      load: () => {
        const status = statuses[Math.min(calls, statuses.length - 1)] ?? 'DELIVERED';
        calls += 1;
        return Promise.resolve(delivery(status, 'delivery-1', {
          serviceClass: 'FLEXIBLE',
          riderLocation: status === 'COLLECTING' ? { latitude: -17.8, longitude: 31.1 } : null,
        }));
      },
      clock: timer.tracking,
      isAuthError: () => false,
      errorText: () => 'offline',
      onChange: () => undefined,
    });

    tracker.setFocused(true);
    await Promise.resolve();
    expect(timer.pending()?.delayMs).toBe(TRACKING_POLL_MS);
    timer.fire();
    await Promise.resolve();
    expect(calls).toBe(2);
    expect(timer.pending()).toBeNull();

    tracker.setFocused(false);
    expect(timer.pending()).toBeNull();
  });

  it('keeps the marketplace delivery when a refresh fails', async () => {
    const timer = clock();
    const seen: Array<CustomerDeliveryDetail['serviceClass'] | undefined> = [];
    let calls = 0;
    const tracker = createDeliveryTracker({
      load: () => {
        calls += 1;
        if (calls === 2) {
          return Promise.reject(new Error('Network request failed. Check your connection and try again.'));
        }
        return Promise.resolve(delivery('RIDER_ASSIGNED', 'delivery-1', { serviceClass: 'EXPRESS', offeredPrice: '9.00' }));
      },
      clock: timer.tracking,
      isAuthError: () => false,
      errorText: () => 'offline',
      onChange: (snapshot) => {
        if (snapshot.delivery) {
          seen.push(snapshot.delivery.serviceClass);
        }
      },
    });
    tracker.setFocused(true);
    await Promise.resolve();
    tracker.refresh();
    await Promise.resolve();
    expect(seen).toEqual(['EXPRESS', 'EXPRESS']);
    expect(calls).toBe(2);
  });
});
