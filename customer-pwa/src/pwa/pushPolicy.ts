export type PushPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export type PushBinding = {
  accountId: string;
  token: string;
};

const DELIVERY_ID = /^[A-Za-z0-9-]{1,80}$/;

export function notificationPermission(input: {
  notification: boolean;
  serviceWorker: boolean;
  permission: NotificationPermission | null;
}): PushPermission {
  if (!input.notification || !input.serviceWorker || !input.permission) return 'unsupported';
  if (input.permission === 'granted' || input.permission === 'denied' || input.permission === 'default') {
    return input.permission;
  }
  return 'unsupported';
}

export function accountIdFromAccessToken(accessToken: string): string | null {
  const payload = accessToken.split('.')[1];
  if (!payload) return null;
  try {
    const parsed: unknown = JSON.parse(decodeBase64Url(payload));
    if (typeof parsed !== 'object' || parsed === null || !('sub' in parsed)) return null;
    const sub = parsed.sub;
    return typeof sub === 'string' && sub.trim().length > 0 ? sub.trim() : null;
  } catch {
    return null;
  }
}

export function pushRegistrationAction(input: {
  signedIn: boolean;
  permission: PushPermission;
  configured: boolean;
  accountId: string | null;
  token: string | null;
  binding: PushBinding | null;
  pendingDetach: boolean;
}): 'register' | 'keep' | 'wait' {
  if (!input.signedIn || input.permission !== 'granted' || !input.configured) return 'wait';
  if (!input.accountId || !input.token) return 'wait';
  if (
    input.pendingDetach
    || !input.binding
    || input.binding.accountId !== input.accountId
    || input.binding.token !== input.token
  ) {
    return 'register';
  }
  return 'keep';
}

export function readPushData(value: unknown): { type: string | null; deliveryId: string | null } {
  const record = nestedPushData(value);
  return {
    type: text(record?.type),
    deliveryId: text(record?.deliveryId),
  };
}

export function deliveryPathFromPushData(value: unknown): string | null {
  const id = readPushData(value).deliveryId;
  if (!id || !DELIVERY_ID.test(id)) return null;
  return `/deliveries/${id}`;
}

export function backgroundDisplaysAutomatically(payload: { notification?: { title?: string } | null }): boolean {
  return Boolean(payload.notification?.title);
}

export function customerPushVisible(activeAccountId: string | null, messageAccountId: string | null): boolean {
  return activeAccountId !== null && messageAccountId !== null && activeAccountId === messageAccountId;
}

export function pushCopy(value: unknown): { title: string | null; body: string | null; accountId: string | null } {
  const record = nestedPushData(value);
  return {
    title: text(record?.title),
    body: text(record?.body),
    accountId: text(record?.accountId),
  };
}

export function backgroundNoticeAction(input: {
  accountVisible: boolean;
  displaysAutomatically: boolean;
  hasTitle: boolean;
}): 'close' | 'skip' | 'show' {
  if (input.displaysAutomatically) return input.accountVisible ? 'skip' : 'close';
  if (!input.accountVisible || !input.hasTitle) return 'skip';
  return 'show';
}

export function foregroundNoticeKey(payload: {
  messageId?: string;
  data?: Record<string, string>;
  notification?: { title?: string; body?: string } | null;
}): string | null {
  const data = readPushData(payload.data ?? payload);
  if (payload.messageId) return payload.messageId;
  if (!data.type && !data.deliveryId && !payload.notification?.title) return null;
  return `${data.type ?? payload.notification?.title ?? 'notice'}:${data.deliveryId ?? ''}`;
}

export function shouldShowForegroundNotice(previousKey: string | null, nextKey: string | null, visible: boolean): boolean {
  return visible && nextKey !== null && nextKey !== previousKey;
}

function nestedPushData(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const fcm = value.FCM_MSG;
  if (isRecord(fcm) && isRecord(fcm.data)) return fcm.data;
  if (isRecord(value.data)) return value.data;
  return value;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  return decodeURIComponent(Array.from(atob(padded), (char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''));
}
