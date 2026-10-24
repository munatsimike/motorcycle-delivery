const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CUSTOMER_PUSH_TYPES = {
  v2_request_reopened: 'request',
  v2_deadline_reminder: 'request',
  v2_collecting: 'delivery',
  v2_collected: 'delivery',
  v2_out_for_delivery: 'delivery',
  v2_delivered: 'delivery',
} as const;

export type CustomerPushType = keyof typeof CUSTOMER_PUSH_TYPES;
export type CustomerPushDestination = (typeof CUSTOMER_PUSH_TYPES)[CustomerPushType];

export type CustomerPush = {
  type: CustomerPushType;
  deliveryId: string;
  destination: CustomerPushDestination;
};

export type DevicePushToken = {
  type: string;
  data: unknown;
};

export const DELIVERY_CHANNEL_ID = 'default';

export function foregroundNotificationBehavior(): {
  shouldShowBanner: boolean;
  shouldShowList: boolean;
  shouldPlaySound: boolean;
  shouldSetBadge: boolean;
} {
  return {
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  };
}

export function fcmTokenWhenPermitted(granted: boolean, token: DevicePushToken | null): string | null {
  if (!granted) {
    return null;
  }
  return fcmTokenFromDevice(token);
}

export function fcmTokenFromDevice(token: DevicePushToken | null): string | null {
  if (!token || token.type !== 'android' || typeof token.data !== 'string') {
    return null;
  }
  const value = token.data.trim();
  if (!value || value.length > 512 || value.startsWith('ExponentPushToken')) {
    return null;
  }
  return value;
}

export function customerPushSetupDiagnostic(input: {
  executionEnvironment: string | null;
  permissionGranted: boolean;
  tokenAccepted: boolean;
}): string | null {
  if (input.executionEnvironment === 'storeClient') {
    return 'Expo Go cannot register a Firebase token. Install the Riders Android development build on this phone.';
  }
  if (!input.permissionGranted || input.tokenAccepted) {
    return null;
  }
  return 'This build did not return an Android FCM token. Confirm google-services.json for this package is included in the development build.';
}

export function readCustomerPush(data: unknown): CustomerPush | null {
  const record = pushRecord(data);
  if (!record) {
    return null;
  }
  const type = record.type;
  if (typeof type !== 'string' || !(type in CUSTOMER_PUSH_TYPES)) {
    return null;
  }
  const deliveryId = typeof record.deliveryId === 'string' ? record.deliveryId.trim() : '';
  if (!UUID_TEXT.test(deliveryId)) {
    return null;
  }
  const pushType = type as CustomerPushType;
  return {
    type: pushType,
    deliveryId,
    destination: CUSTOMER_PUSH_TYPES[pushType],
  };
}

export function trackingParams(push: CustomerPush): { deliveryId: string } {
  return { deliveryId: push.deliveryId };
}

function pushRecord(data: unknown): Record<string, unknown> | null {
  if (!isRecord(data)) {
    return null;
  }
  if (isRecord(data.data) && typeof data.data.type === 'string') {
    return data.data;
  }
  return data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
