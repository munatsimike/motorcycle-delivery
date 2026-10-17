import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { sendExpoPush } from './expo-push.js';
import { GPS_FRESH_MS } from './dispatch.constants.js';
import { countNearbyAvailableRiders } from './nearby-riders.query.js';
import { RIDER_ALERT_TTL_MS } from './rider-availability-alert.constants.js';
import {
  cancelRiderAvailabilityAlert,
  processRiderAvailabilityAlerts,
  readAlertRequest,
  subscribeToRiderAvailability,
  type RiderAlertDeps,
} from './rider-availability-alert.service.js';
import {
  createMemoryAlertStore,
  PrismaRiderAvailabilityAlertStore,
} from './rider-availability-alert.store.js';
import { RiderAvailabilityAlertWorker } from './rider-availability-alert.worker.js';

const CUSTOMER_ID = '0199f0a0-0000-7000-8000-000000000001';
const TOKEN = 'ExponentPushToken[customer-device-token]';
const NOW = new Date('2026-10-16T12:00:00.000Z');

describe('rider availability alerts', () => {
  it('does not save an alert when a rider is already nearby', async () => {
    const store = createMemoryAlertStore();
    const nearby = vi.fn(async () => 2);
    const push = vi.fn(async () => 'sent' as const);

    await expect(subscribeToRiderAvailability(deps(store, nearby, push), CUSTOMER_ID, request(), NOW)).resolves.toEqual({
      result: 'riders-available',
      count: 2,
    });

    expect(store.alerts).toHaveLength(0);
    expect(store.devices).toHaveLength(0);
    expect(push).not.toHaveBeenCalled();
  });

  it('keeps one alert when the customer subscribes again', async () => {
    const store = createMemoryAlertStore();
    const first = await subscribeToRiderAvailability(deps(store, async () => 0, async () => 'sent'), CUSTOMER_ID, request(), NOW);
    const later = new Date(NOW.getTime() + 60_000);
    const second = await subscribeToRiderAvailability(
      deps(store, async () => 0, async () => 'sent'),
      CUSTOMER_ID,
      request(-17.9, 31.1),
      later,
    );

    expect(first).toEqual({ result: 'active', expiresAt: new Date(NOW.getTime() + RIDER_ALERT_TTL_MS).toISOString() });
    expect(second).toEqual(first);
    expect(store.alerts).toHaveLength(1);
    expect(store.alerts[0]).toMatchObject({ latitude: -17.9, longitude: 31.1, status: 'ACTIVE' });
    expect(store.devices).toHaveLength(1);
  });

  it('rejects a missing notification token before checking riders', async () => {
    const nearby = vi.fn(async () => 0);
    await expect(subscribeToRiderAvailability(
      deps(createMemoryAlertStore(), nearby, async () => 'sent'),
      CUSTOMER_ID,
      { latitude: -17.8252, longitude: 31.0335 },
      NOW,
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(nearby).not.toHaveBeenCalled();
    expect(() => readAlertRequest({ latitude: '91', longitude: '31', expoPushToken: TOKEN })).toThrow(BadRequestException);
  });

  it('does not notify a cancelled or expired alert', async () => {
    const store = createMemoryAlertStore();
    const push = vi.fn(async () => 'sent' as const);
    const nearby = vi.fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValue(3);
    const alertDeps = deps(store, nearby, push);
    await subscribeToRiderAvailability(alertDeps, CUSTOMER_ID, request(), NOW);
    await cancelRiderAvailabilityAlert(alertDeps, CUSTOMER_ID, NOW);
    await processRiderAvailabilityAlerts(alertDeps, new Date(NOW.getTime() + 1_000));

    const expired = createMemoryAlertStore();
    await subscribeToRiderAvailability(deps(expired, async () => 0, push), CUSTOMER_ID, request(), NOW);
    await processRiderAvailabilityAlerts(
      deps(expired, async () => 3, push),
      new Date(NOW.getTime() + RIDER_ALERT_TTL_MS + 1_000),
    );

    expect(push).not.toHaveBeenCalled();
    expect(store.alerts[0]?.status).toBe('CANCELLED');
    expect(expired.alerts[0]?.status).toBe('EXPIRED');
  });

  it('waits for a fresh eligible rider and sends once', async () => {
    const store = createMemoryAlertStore();
    const push = vi.fn(async () => 'sent' as const);
    const nearby = vi.fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValue(1);
    const alertDeps = deps(store, nearby, push);
    await subscribeToRiderAvailability(alertDeps, CUSTOMER_ID, request(), NOW);

    await processRiderAvailabilityAlerts(alertDeps, new Date(NOW.getTime() + 20_000));
    expect(push).not.toHaveBeenCalled();
    expect(nearby).toHaveBeenLastCalledWith(-17.8252, 31.0335, new Date(NOW.getTime() + 20_000));

    await processRiderAvailabilityAlerts(alertDeps, new Date(NOW.getTime() + 40_000));
    await processRiderAvailabilityAlerts(alertDeps, new Date(NOW.getTime() + 60_000));

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(TOKEN);
    expect(store.alerts[0]?.status).toBe('NOTIFIED');
  });

  it('retries a temporary push failure and invalidates a dead token', async () => {
    const store = createMemoryAlertStore();
    const push = vi.fn()
      .mockResolvedValueOnce('retry')
      .mockResolvedValueOnce('sent');
    const nearby = vi.fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValue(1);
    const alertDeps = deps(store, nearby, push);
    await subscribeToRiderAvailability(alertDeps, CUSTOMER_ID, request(), NOW);

    const firstCheck = new Date(NOW.getTime() + 20_000);
    await processRiderAvailabilityAlerts(alertDeps, firstCheck);
    await processRiderAvailabilityAlerts(alertDeps, new Date(firstCheck.getTime() + 1_000));
    expect(push).toHaveBeenCalledTimes(1);
    expect(store.alerts[0]).toMatchObject({ status: 'ACTIVE', attemptCount: 1 });

    await processRiderAvailabilityAlerts(alertDeps, new Date(firstCheck.getTime() + 30_000));
    expect(push).toHaveBeenCalledTimes(2);
    expect(store.alerts[0]?.status).toBe('NOTIFIED');

    const dead = createMemoryAlertStore();
    const deadPush = vi.fn(async () => 'invalid-token' as const);
    await subscribeToRiderAvailability(deps(dead, async () => 0, deadPush), CUSTOMER_ID, request(), NOW);
    await processRiderAvailabilityAlerts(deps(dead, async () => 1, deadPush), firstCheck);
    expect(dead.devices[0]?.invalidatedAt).toEqual(firstCheck);
    expect(dead.alerts[0]?.status).toBe('ACTIVE');
  });

  it('does not mark an alert notified when it is cancelled before the push completes', async () => {
    const store = createMemoryAlertStore();
    const push = vi.fn(async () => {
      await store.cancelOpen(CUSTOMER_ID);
      return 'sent' as const;
    });
    const nearby = vi.fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValue(1);
    const alertDeps = deps(store, nearby, push);
    await subscribeToRiderAvailability(alertDeps, CUSTOMER_ID, request(), NOW);
    await processRiderAvailabilityAlerts(alertDeps, new Date(NOW.getTime() + 20_000));

    expect(push).toHaveBeenCalledTimes(1);
    expect(store.alerts[0]?.status).toBe('CANCELLED');
  });

  it('claims pending alerts with a row lock and stores the search point in PostGIS', async () => {
    const db = fakeSql();
    const store = new PrismaRiderAvailabilityAlertStore(db.client);
    await store.claimDue(NOW, 20);
    db.rows.push({
      id: '0199f0a0-0000-7000-8000-000000000002',
      customer_account_id: CUSTOMER_ID,
      latitude: '-17.8252000',
      longitude: '31.0335000',
      expires_at: new Date(NOW.getTime() + RIDER_ALERT_TTL_MS),
      attempt_count: 0,
      status: 'ACTIVE',
    });
    await store.saveOpen({
      customerAccountId: CUSTOMER_ID,
      latitude: -17.8252,
      longitude: 31.0335,
      now: NOW,
      expiresAt: new Date(NOW.getTime() + RIDER_ALERT_TTL_MS),
    });

    expect(db.calls[0]?.sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(db.calls[0]?.sql).toContain('ACTIVE');
    expect(db.calls[1]?.sql).toContain('ST_SetSRID');
    expect(db.calls[1]?.sql).toContain('geography');
    expect(db.calls[1]?.values).toContain(CUSTOMER_ID);
  });

  it('checks the same fresh nearby-rider query before an alert can send', async () => {
    const db = fakeSql([{ count: 0 }]);
    await countNearbyAvailableRiders(db.client, {
      latitude: -17.8252,
      longitude: 31.0335,
      freshAfter: new Date(NOW.getTime() - GPS_FRESH_MS),
    });
    expect(db.calls[0]?.sql).toContain('ST_DWithin');
    expect(db.calls[0]?.sql).toContain('updated_at');
    expect(db.calls[0]?.sql).toContain(`'AVAILABLE'`);
    expect(db.calls[0]?.values).toContainEqual(new Date(NOW.getTime() - GPS_FRESH_MS));
  });

  it('lets one worker run finish before the next starts', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const worker = new RiderAvailabilityAlertWorker({
      processDue: () => {
        calls += 1;
        return gate;
      },
    } as never, {
      addInterval() {},
      doesExist: () => false,
      deleteInterval() {},
    } as never);

    const first = worker.run(NOW);
    const second = worker.run(NOW);
    release();
    await first;
    await second;
    expect(calls).toBe(1);
  });
});

describe('expo push tickets', () => {
  it('treats provider outages as retryable and dead tokens as invalid', async () => {
    await expect(sendExpoPush(TOKEN, fakeFetch({ status: 503, body: {} }))).resolves.toBe('retry');
    let sentBody: unknown;
    const sent = sendExpoPush(TOKEN, (async (_url: string, init?: { body?: string }) => {
      sentBody = JSON.parse(String(init?.body));
      return {
        status: 200,
        ok: true,
        json: async () => ({ data: { status: 'ok' } }),
      };
    }) as typeof fetch);
    await expect(sent).resolves.toBe('sent');
    expect(sentBody).toMatchObject({
      title: 'A rider is available',
      channelId: 'rider-availability',
      data: { kind: 'rider-availability' },
    });
    await expect(sendExpoPush(TOKEN, fakeFetch({
      status: 200,
      body: { data: { status: 'error', details: { error: 'DeviceNotRegistered' } } },
    }))).resolves.toBe('invalid-token');
    await expect(sendExpoPush(TOKEN, async () => {
      throw new Error('offline');
    })).resolves.toBe('retry');
  });
});

function request(latitude = -17.8252, longitude = 31.0335) {
  return { latitude, longitude, expoPushToken: TOKEN };
}

function deps(
  store: RiderAlertDeps['store'],
  nearby: RiderAlertDeps['nearby']['count'],
  push: RiderAlertDeps['push']['send'],
): RiderAlertDeps {
  return { store, nearby: { count: nearby }, push: { send: push } };
}

function fakeSql(rows: unknown[] = []) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const client = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join(' '), values });
      return rows;
    },
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join(' '), values });
      return 1;
    },
  };
  return { calls, rows, client: client as never };
}

function fakeFetch(response: { status: number; body: unknown }): typeof fetch {
  return (async () => ({
    status: response.status,
    ok: response.status >= 200 && response.status < 300,
    json: async () => response.body,
  })) as typeof fetch;
}
