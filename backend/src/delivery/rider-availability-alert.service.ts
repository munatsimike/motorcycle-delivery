import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { PushSender } from './expo-push.js';
import { sendExpoPush } from './expo-push.js';
import { countNearbyAvailableRiders, nearbyFreshAfter } from './nearby-riders.query.js';
import { readNearbyPoint } from './nearby-riders.service.js';
import {
  nextRiderAlertAttempt,
  RIDER_ALERT_CLAIM_LIMIT,
  RIDER_ALERT_STALE_CLAIM_MS,
  riderAlertExpiresAt,
} from './rider-availability-alert.constants.js';
import {
  PrismaRiderAvailabilityAlertStore,
  type ClaimedAlert,
  type RiderAvailabilityAlertStore,
} from './rider-availability-alert.store.js';

export type RiderAlertView =
  | { alert: null }
  | { alert: { status: 'active'; expiresAt: string } };

export type SubscribeRiderAlertResult =
  | { result: 'riders-available'; count: number }
  | { result: 'active'; expiresAt: string };

type NearbyCounter = {
  count(latitude: number, longitude: number, now: Date): Promise<number>;
};

export type RiderAlertDeps = {
  store: RiderAvailabilityAlertStore;
  nearby: NearbyCounter;
  push: PushSender;
};

@Injectable()
export class RiderAvailabilityAlertService {
  private readonly deps: RiderAlertDeps;

  constructor(prisma: PrismaService) {
    this.deps = {
      store: new PrismaRiderAvailabilityAlertStore(prisma),
      nearby: {
        count: (latitude, longitude, now) => countNearbyAvailableRiders(prisma, {
          latitude,
          longitude,
          freshAfter: nearbyFreshAfter(now),
        }),
      },
      push: { send: sendExpoPush },
    };
  }

  current(customerAccountId: string, now = new Date()): Promise<RiderAlertView> {
    return readRiderAvailabilityAlert(this.deps, customerAccountId, now);
  }

  subscribe(customerAccountId: string, body: unknown, now = new Date()): Promise<SubscribeRiderAlertResult> {
    return subscribeToRiderAvailability(this.deps, customerAccountId, body, now);
  }

  cancel(customerAccountId: string, now = new Date()): Promise<RiderAlertView> {
    return cancelRiderAvailabilityAlert(this.deps, customerAccountId, now);
  }

  processDue(now = new Date()): Promise<void> {
    return processRiderAvailabilityAlerts(this.deps, now);
  }
}

export async function readRiderAvailabilityAlert(
  deps: RiderAlertDeps,
  customerAccountId: string,
  now: Date,
): Promise<RiderAlertView> {
  const alert = await deps.store.findOpen(customerAccountId, now);
  if (!alert) {
    return { alert: null };
  }
  return { alert: { status: 'active', expiresAt: alert.expiresAt.toISOString() } };
}

export async function subscribeToRiderAvailability(
  deps: RiderAlertDeps,
  customerAccountId: string,
  body: unknown,
  now: Date,
): Promise<SubscribeRiderAlertResult> {
  const request = readAlertRequest(body);
  const count = await deps.nearby.count(request.latitude, request.longitude, now);
  if (count > 0) {
    return { result: 'riders-available', count };
  }
  await deps.store.saveToken(customerAccountId, request.expoPushToken, now);
  const alert = await deps.store.saveOpen({
    customerAccountId,
    latitude: request.latitude,
    longitude: request.longitude,
    now,
    expiresAt: riderAlertExpiresAt(now),
  });
  return { result: 'active', expiresAt: alert.expiresAt.toISOString() };
}

export async function cancelRiderAvailabilityAlert(
  deps: RiderAlertDeps,
  customerAccountId: string,
  now: Date,
): Promise<RiderAlertView> {
  void now;
  await deps.store.cancelOpen(customerAccountId);
  return { alert: null };
}

export async function processRiderAvailabilityAlerts(deps: RiderAlertDeps, now: Date): Promise<void> {
  await deps.store.expireDue(now);
  await deps.store.releaseStaleClaims(new Date(now.getTime() - RIDER_ALERT_STALE_CLAIM_MS), now);
  const claimed = await deps.store.claimDue(now, RIDER_ALERT_CLAIM_LIMIT);
  for (const alert of claimed) {
    await deliverClaimedAlert(deps, alert, now);
  }
}

async function deliverClaimedAlert(deps: RiderAlertDeps, alert: ClaimedAlert, now: Date): Promise<void> {
  try {
    if (alert.expiresAt.getTime() <= now.getTime()) {
      await deps.store.expireSending(alert.id);
      return;
    }
    if (!(await deps.store.isSending(alert.id))) {
      return;
    }
    const count = await deps.nearby.count(alert.latitude, alert.longitude, now);
    if (count < 1) {
      await deps.store.reschedule({
        id: alert.id,
        nextAttemptAt: null,
        incrementAttempt: false,
        failure: null,
      });
      return;
    }
    const tokens = await deps.store.tokensFor(alert.customerAccountId);
    if (tokens.length === 0) {
      await deps.store.reschedule({
        id: alert.id,
        nextAttemptAt: nextRiderAlertAttempt(now, alert.attemptCount + 1),
        incrementAttempt: true,
        failure: 'no-token',
      });
      return;
    }
    if (!(await deps.store.isSending(alert.id))) {
      return;
    }

    let sent = false;
    let retry = false;
    for (const token of tokens) {
      const outcome = await deps.push.send(token);
      if (outcome === 'sent') {
        sent = true;
      } else if (outcome === 'invalid-token') {
        await deps.store.invalidateToken(token, now);
      } else {
        retry = true;
      }
    }

    if (!(await deps.store.isSending(alert.id))) {
      return;
    }
    if (sent) {
      await deps.store.markNotified(alert.id, now);
      return;
    }
    await deps.store.reschedule({
      id: alert.id,
      nextAttemptAt: nextRiderAlertAttempt(now, alert.attemptCount + 1),
      incrementAttempt: true,
      failure: retry ? 'push-retry' : 'invalid-token',
    });
  } catch {
    await deps.store.reschedule({
      id: alert.id,
      nextAttemptAt: nextRiderAlertAttempt(now, alert.attemptCount + 1),
      incrementAttempt: true,
      failure: 'push-retry',
    });
  }
}

export function readAlertRequest(body: unknown): { latitude: number; longitude: number; expoPushToken: string } {
  if (!body || typeof body !== 'object') {
    throw new BadRequestException('Enter a valid location');
  }
  const record = body as Record<string, unknown>;
  const point = readNearbyPoint({
    latitude: coordinateText(record.latitude),
    longitude: coordinateText(record.longitude),
  });
  if (typeof record.expoPushToken !== 'string' || !isExpoPushToken(record.expoPushToken)) {
    throw new BadRequestException('A notification token is required');
  }
  return { ...point, expoPushToken: record.expoPushToken };
}

export function isExpoPushToken(value: string): boolean {
  return value.length <= 255 && /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/.test(value);
}

function coordinateText(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
}
