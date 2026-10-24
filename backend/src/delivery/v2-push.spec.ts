import { describe, expect, it } from 'vitest';
import { customerDeliveryNotification, firebaseAccountReady, v2FcmBody, v2ProviderFailure } from './fcm-v2-sender.js';
import { V2_NOTICE_MAX_RETRY_MS, v2NoticeConfig, v2RetryAt } from './v2-notice.js';

const CUSTOMER_COPY = {
  v2_request_reopened: 'Your delivery request is open again.',
  v2_deadline_reminder: 'Your delivery deadline needs attention.',
  v2_collecting: 'Your rider is collecting your parcel.',
  v2_collected: 'Your parcel has been collected.',
  v2_out_for_delivery: 'Your parcel is on its way.',
  v2_delivered: 'Your parcel has been delivered.',
} as const;

describe('V2 push payload', () => {
  it('shows a customer notification and keeps the navigation data', () => {
    for (const [type, body] of Object.entries(CUSTOMER_COPY)) {
      const message = v2FcmBody({
        token: 'device-token',
        type,
        deliveryId: 'delivery-1',
        assignmentId: 'assignment-1',
        audience: 'customer',
      });
      expect(message.message.data).toEqual({
        type,
        deliveryId: 'delivery-1',
        assignmentId: 'assignment-1',
      });
      expect(message.message.notification).toEqual(customerDeliveryNotification(type));
      expect(message.message.notification?.body).toBe(body);
      expect(message.message.android.notification?.channel_id).toBe('default');
      const encoded = JSON.stringify(message);
      expect(encoded).not.toContain('Pickup');
      expect(encoded).not.toContain('+263');
      expect(encoded).not.toContain('rider_offer');
    }
  });

  it('leaves rider bid acceptance as a data message', () => {
    const body = v2FcmBody({
      token: 'device-token',
      type: 'v2_bid_accepted',
      deliveryId: 'delivery-1',
      assignmentId: 'assignment-1',
      audience: 'rider',
    });
    expect(body.message.data).toEqual({
      type: 'v2_bid_accepted',
      deliveryId: 'delivery-1',
      assignmentId: 'assignment-1',
    });
    expect(body.message).not.toHaveProperty('notification');
    expect(body.message.android).not.toHaveProperty('notification');
    expect(customerDeliveryNotification('v2_bid_accepted')).toBeNull();
  });

  it('treats a missing or incomplete Firebase account as unconfigured', () => {
    expect(firebaseAccountReady(undefined)).toBe(false);
    expect(firebaseAccountReady('')).toBe(false);
    expect(firebaseAccountReady('{')).toBe(false);
    expect(firebaseAccountReady('{"project_id":"riders"}')).toBe(false);
    expect(firebaseAccountReady(JSON.stringify({
      project_id: 'riders',
      client_email: 'push@riders.test',
      private_key: 'local-test-key',
    }))).toBe(true);
  });

  it('keeps the provider timeout inside the claim lease', () => {
    const defaults = v2NoticeConfig({});
    expect(defaults.timeoutMs).toBe(3_000);
    expect(defaults.leaseMs).toBe(30_000);
    expect(defaults.maxAttempts).toBe(5);
    expect(defaults.timeoutMs * 8).toBeLessThanOrEqual(defaults.leaseMs);
    const raised = v2NoticeConfig({ V2_NOTICE_CLAIM_LEASE_MS: '1000' });
    expect(raised.leaseMs).toBe(raised.timeoutMs * 8);
    expect(v2NoticeConfig({ V2_NOTICE_MAX_ATTEMPTS: '2' }).maxAttempts).toBe(2);
    expect(v2NoticeConfig({ V2_NOTICE_PROVIDER_TIMEOUT_MS: 'nope' }).timeoutMs).toBe(3_000);
  });

  it('classifies an aborted provider call as a timeout', () => {
    expect(v2ProviderFailure(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))).toBe('timeout');
    expect(v2ProviderFailure(new Error('network'))).toBe('temporary');
  });

  it('waits longer after each failure and then keeps the wait capped', () => {
    const now = new Date('2026-10-24T08:00:00.000Z');
    expect(v2RetryAt(1, now).getTime() - now.getTime()).toBe(2_000);
    expect(v2RetryAt(2, now).getTime() - now.getTime()).toBe(4_000);
    expect(v2RetryAt(3, now).getTime() - now.getTime()).toBe(8_000);
    expect(v2RetryAt(30, now).getTime() - now.getTime()).toBe(V2_NOTICE_MAX_RETRY_MS);
  });
});
