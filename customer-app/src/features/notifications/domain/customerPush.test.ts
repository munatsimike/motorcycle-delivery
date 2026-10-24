import { describe, expect, it } from 'vitest';

import { fcmTokenFromDevice, fcmTokenWhenPermitted, customerPushSetupDiagnostic, foregroundNotificationBehavior, readCustomerPush, trackingParams, DELIVERY_CHANNEL_ID } from './customerPush';
import { createPushInteractions } from './customerPushNavigation';
import {
  PUSH_DEREGISTER_FAILED,
  registrationDecision,
  removePushRegistration,
  syncPushRegistration,
  type PushRegistrationStore,
} from './customerPushRegistration';

const DELIVERY = '11111111-1111-4111-8111-111111111111';

function memoryStore(initial: { customerId: string; token: string } | null = null): PushRegistrationStore & { current(): typeof initial } {
  let saved = initial;
  return {
    current: () => saved,
    async load() {
      return saved;
    },
    async save(registration) {
      saved = registration;
    },
    async clear() {
      saved = null;
    },
  };
}

describe('customer push tokens', () => {
  it('accepts an Android FCM token and rejects Expo and Apple tokens', () => {
    expect(fcmTokenFromDevice({ type: 'android', data: 'fcm-device-token' })).toBe('fcm-device-token');
    expect(fcmTokenFromDevice({ type: 'ios', data: 'apns-device-token' })).toBeNull();
    expect(fcmTokenFromDevice({ type: 'android', data: 'ExponentPushToken[abc]' })).toBeNull();
    expect(fcmTokenFromDevice({ type: 'expo', data: 'ExponentPushToken[abc]' })).toBeNull();
    expect(fcmTokenWhenPermitted(false, { type: 'android', data: 'fcm-device-token' })).toBeNull();
    expect(fcmTokenWhenPermitted(true, { type: 'ios', data: 'apns-device-token' })).toBeNull();
    expect(customerPushSetupDiagnostic({
      executionEnvironment: 'storeClient',
      permissionGranted: true,
      tokenAccepted: false,
    })).toBe('Expo Go cannot register a Firebase token. Install the Riders Android development build on this phone.');
    expect(customerPushSetupDiagnostic({
      executionEnvironment: 'bare',
      permissionGranted: true,
      tokenAccepted: false,
    })).toBe('This build did not return an Android FCM token. Confirm google-services.json for this package is included in the development build.');
    expect(customerPushSetupDiagnostic({
      executionEnvironment: 'bare',
      permissionGranted: false,
      tokenAccepted: false,
    })).toBeNull();
    expect(customerPushSetupDiagnostic({
      executionEnvironment: 'bare',
      permissionGranted: true,
      tokenAccepted: true,
    })).toBeNull();
  });

  it('registers a new or rotated token once for the signed-in customer', async () => {
    const store = memoryStore();
    const calls: string[] = [];
    expect(await syncPushRegistration({
      accessToken: 'token-a',
      customerId: 'customer-a',
      token: 'fcm-1',
      store,
      register: async (_accessToken, token) => {
        calls.push(token);
        return 'registered';
      },
    })).toBe('registered');
    expect(await syncPushRegistration({
      accessToken: 'token-a',
      customerId: 'customer-a',
      token: 'fcm-1',
      store,
      register: async () => 'registered',
    })).toBe('skipped');
    expect(registrationDecision(store.current(), 'customer-b', 'fcm-1')).toBe('register');
    expect(await syncPushRegistration({
      accessToken: 'token-b',
      customerId: 'customer-a',
      token: 'fcm-2',
      store,
      register: async (_accessToken, token) => {
        calls.push(token);
        return 'registered';
      },
    })).toBe('registered');
    expect(calls).toEqual(['fcm-1', 'fcm-2']);
    expect(store.current()).toEqual({ customerId: 'customer-a', token: 'fcm-2' });
    expect(await syncPushRegistration({
      accessToken: 'token-b',
      customerId: 'customer-b',
      token: 'fcm-2',
      store,
      register: async (_accessToken, token) => {
        calls.push(`switch:${token}`);
        return 'registered';
      },
    })).toBe('registered');
    expect(calls).toEqual(['fcm-1', 'fcm-2', 'switch:fcm-2']);
    expect(store.current()).toEqual({ customerId: 'customer-b', token: 'fcm-2' });
  });

  it('keeps the saved token when deregistration fails', async () => {
    const store = memoryStore({ customerId: 'customer-a', token: 'fcm-1' });
    const result = await removePushRegistration({
      accessToken: 'token-a',
      store,
      remove: async () => {
        throw new Error('offline');
      },
    });
    expect(result).toBe('failed');
    expect(PUSH_DEREGISTER_FAILED).toBe('This device could not be removed from delivery alerts.');
    expect(store.current()).toEqual({ customerId: 'customer-a', token: 'fcm-1' });
  });

  it('removes the saved token only after the server accepts it', async () => {
    const store = memoryStore({ customerId: 'customer-a', token: 'fcm-1' });
    const removed: string[] = [];
    expect(await removePushRegistration({
      accessToken: 'token-a',
      store,
      remove: async (_accessToken, token) => {
        removed.push(token);
      },
    })).toBe('removed');
    expect(removed).toEqual(['fcm-1']);
    expect(store.current()).toBeNull();
    expect(await removePushRegistration({
      accessToken: null,
      store,
      remove: async () => undefined,
    })).toBe('skipped');
  });
});

describe('customer push navigation', () => {
  it('opens the reopened request and the delivery events after sign-in', () => {
    const interactions = createPushInteractions();
    const reopened = readCustomerPush({ type: 'v2_request_reopened', deliveryId: DELIVERY, url: 'https://example.test/steal' });
    expect(reopened?.destination).toBe('request');
    expect(trackingParams(reopened!)).toEqual({ deliveryId: DELIVERY });
    expect(interactions.accept('tap-1', reopened)).toBe('deferred');
    expect(interactions.take(false, true)).toBeNull();
    expect(interactions.take(true, false)).toBeNull();
    expect(interactions.take(true, true)?.push.deliveryId).toBe(DELIVERY);
    expect(interactions.accept('tap-1', reopened)).toBe('duplicate');

    for (const type of ['v2_collecting', 'v2_collected', 'v2_out_for_delivery', 'v2_delivered', 'v2_deadline_reminder']) {
      const push = readCustomerPush({ type, deliveryId: DELIVERY, status: 'SEARCHING' });
      expect(push?.type).toBe(type);
      expect(trackingParams(push!)).toEqual({ deliveryId: DELIVERY });
      expect(push).not.toHaveProperty('status');
    }
    expect(readCustomerPush({ type: 'v2_deadline_reminder', deliveryId: DELIVERY })?.destination).toBe('request');
    expect(readCustomerPush({ type: 'v2_bid_accepted', deliveryId: DELIVERY })).toBeNull();
    expect(readCustomerPush({ type: 'rider_offer', deliveryId: DELIVERY })).toBeNull();
    expect(readCustomerPush({ type: 'v2_collecting', deliveryId: 'not-a-delivery' })).toBeNull();
    expect(readCustomerPush({ url: 'https://example.test/delivery' })).toBeNull();
  });

  it('presents one foreground banner and opens a cold start only after sign-in', () => {
    expect(foregroundNotificationBehavior()).toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });
    expect(DELIVERY_CHANNEL_ID).toBe('default');
    const interactions = createPushInteractions();
    const push = readCustomerPush({
      data: { type: 'v2_delivered', deliveryId: DELIVERY, assignmentId: '22222222-2222-4222-8222-222222222222' },
    });
    expect(interactions.accept('cold-start', push)).toBe('deferred');
    expect(interactions.take(false, true)).toBeNull();
    expect(interactions.take(true, true)?.push).toEqual({
      type: 'v2_delivered',
      deliveryId: DELIVERY,
      destination: 'delivery',
    });
    expect(interactions.accept('cold-start', push)).toBe('duplicate');
  });
});
