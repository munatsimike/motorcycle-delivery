import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accountIdFromAccessToken,
  backgroundDisplaysAutomatically,
  backgroundNoticeAction,
  customerPushVisible,
  deliveryPathFromPushData,
  foregroundNoticeKey,
  notificationPermission,
  pushRegistrationAction,
  shouldShowForegroundNotice,
} from './pushPolicy.ts';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const DELIVERY = '22222222-2222-4222-8222-222222222222';

test('notification permission is requested only from an explicit grant', () => {
  assert.equal(notificationPermission({
    notification: true,
    serviceWorker: true,
    permission: 'default',
  }), 'default');
  assert.equal(notificationPermission({
    notification: true,
    serviceWorker: true,
    permission: 'granted',
  }), 'granted');
  assert.equal(notificationPermission({
    notification: true,
    serviceWorker: true,
    permission: 'denied',
  }), 'denied');
  assert.equal(notificationPermission({
    notification: false,
    serviceWorker: true,
    permission: 'default',
  }), 'unsupported');
  assert.equal(notificationPermission({
    notification: true,
    serviceWorker: false,
    permission: null,
  }), 'unsupported');
});

test('a restored session registers a granted token and a new account replaces the old binding', () => {
  const token = accessToken(ACCOUNT);
  assert.equal(accountIdFromAccessToken(token), ACCOUNT);
  assert.equal(pushRegistrationAction({
    signedIn: true,
    permission: 'granted',
    configured: true,
    accountId: ACCOUNT,
    token: 'device-1',
    binding: null,
    pendingDetach: false,
  }), 'register');
  assert.equal(pushRegistrationAction({
    signedIn: true,
    permission: 'granted',
    configured: true,
    accountId: ACCOUNT,
    token: 'device-1',
    binding: { accountId: ACCOUNT, token: 'device-1' },
    pendingDetach: false,
  }), 'keep');
  assert.equal(pushRegistrationAction({
    signedIn: true,
    permission: 'granted',
    configured: true,
    accountId: ACCOUNT,
    token: 'device-2',
    binding: { accountId: ACCOUNT, token: 'device-1' },
    pendingDetach: false,
  }), 'register');
  assert.equal(pushRegistrationAction({
    signedIn: true,
    permission: 'granted',
    configured: true,
    accountId: '33333333-3333-4333-8333-333333333333',
    token: 'device-1',
    binding: { accountId: ACCOUNT, token: 'device-1' },
    pendingDetach: true,
  }), 'register');
  assert.equal(pushRegistrationAction({
    signedIn: true,
    permission: 'denied',
    configured: true,
    accountId: ACCOUNT,
    token: 'device-1',
    binding: null,
    pendingDetach: false,
  }), 'wait');
  assert.equal(pushRegistrationAction({
    signedIn: false,
    permission: 'granted',
    configured: true,
    accountId: ACCOUNT,
    token: 'device-1',
    binding: null,
    pendingDetach: false,
  }), 'wait');
});

test('a background notification is not shown twice and a click stays on the delivery route', () => {
  assert.equal(backgroundDisplaysAutomatically({ notification: { title: 'Delivered' } }), true);
  assert.equal(backgroundDisplaysAutomatically({ notification: null }), false);
  const payload = {
    messageId: 'message-1',
    data: { type: 'v2_delivered', deliveryId: DELIVERY },
    notification: { title: 'Delivered', body: 'Your parcel has been delivered.' },
  };
  const key = foregroundNoticeKey(payload);
  assert.equal(shouldShowForegroundNotice(null, key, true), true);
  assert.equal(shouldShowForegroundNotice(key, key, true), false);
  assert.equal(shouldShowForegroundNotice(null, key, false), false);
  assert.equal(deliveryPathFromPushData(payload.data), `/deliveries/${DELIVERY}`);
  assert.equal(deliveryPathFromPushData({ FCM_MSG: { data: { deliveryId: DELIVERY } } }), `/deliveries/${DELIVERY}`);
  assert.equal(deliveryPathFromPushData({ deliveryId: 'https://evil.example/deliveries/1' }), null);
  assert.equal(deliveryPathFromPushData({ deliveryId: '../admin' }), null);
  assert.equal(deliveryPathFromPushData({ FCM_MSG: { fcmOptions: { link: 'https://evil.example' } } }), null);
  assert.equal(customerPushVisible(ACCOUNT, ACCOUNT), true);
  assert.equal(customerPushVisible(null, ACCOUNT), false);
  assert.equal(customerPushVisible(ACCOUNT, '33333333-3333-4333-8333-333333333333'), false);
  assert.equal(backgroundNoticeAction({
    accountVisible: false,
    displaysAutomatically: true,
    hasTitle: true,
  }), 'close');
  assert.equal(backgroundNoticeAction({
    accountVisible: true,
    displaysAutomatically: true,
    hasTitle: true,
  }), 'skip');
  assert.equal(backgroundNoticeAction({
    accountVisible: true,
    displaysAutomatically: false,
    hasTitle: true,
  }), 'show');
  assert.equal(backgroundNoticeAction({
    accountVisible: false,
    displaysAutomatically: false,
    hasTitle: true,
  }), 'skip');
});

function accessToken(accountId: string): string {
  const body = Buffer.from(JSON.stringify({ sub: accountId })).toString('base64url');
  return `header.${body}.signature`;
}
