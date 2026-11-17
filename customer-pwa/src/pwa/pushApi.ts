import { apiRequest } from '../api/client';
import { clearPushAccount } from './pushAccount';
import { accountIdFromAccessToken, type PushBinding } from './pushPolicy';

export const PUSH_BINDING_KEY = 'riders.customer.push.binding';
export const PUSH_DETACH_KEY = 'riders.customer.push.pendingDetach';
export const PUSH_PROMPT_KEY = 'riders.customer.push.prompt';

export async function registerCustomerPushDevice(accessToken: string, fcmToken: string): Promise<void> {
  await apiRequest('/customers/me/push-devices', {
    method: 'PUT',
    accessToken,
    body: { fcmToken },
  });
}

export async function removeCustomerPushDevice(accessToken: string, fcmToken: string): Promise<void> {
  await apiRequest('/customers/me/push-devices', {
    method: 'DELETE',
    accessToken,
    body: { fcmToken },
  });
}

export function readPushBinding(storage: Storage): PushBinding | null {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(PUSH_BINDING_KEY) ?? '');
    if (typeof parsed !== 'object' || parsed === null) return null;
    const accountId = 'accountId' in parsed && typeof parsed.accountId === 'string' ? parsed.accountId : '';
    const token = 'token' in parsed && typeof parsed.token === 'string' ? parsed.token : '';
    if (!accountId || !token) return null;
    return { accountId, token };
  } catch {
    return null;
  }
}

export function writePushBinding(storage: Storage, binding: PushBinding): void {
  storage.setItem(PUSH_BINDING_KEY, JSON.stringify(binding));
  storage.removeItem(PUSH_DETACH_KEY);
}

export async function suspendLocalPush(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return;
  try {
    const shown = await registration.getNotifications();
    shown.forEach((notification) => notification.close());
    await (await registration.pushManager.getSubscription())?.unsubscribe();
  } catch {
    // The server row is still removed or marked for the next account when this browser cannot unsubscribe.
  }
}

export function pushDetachPending(storage: Storage): boolean {
  return storage.getItem(PUSH_DETACH_KEY) !== null;
}

export async function detachCustomerPush(accessToken: string, storage: Storage = localStorage): Promise<void> {
  await clearPushAccount().catch(() => undefined);
  await suspendLocalPush();
  const binding = readPushBinding(storage);
  const pending = storage.getItem(PUSH_DETACH_KEY);
  const token = binding?.token ?? pending;
  if (!token) return;
  const accountId = accountIdFromAccessToken(accessToken);
  if (binding && accountId && binding.accountId !== accountId) {
    storage.setItem(PUSH_DETACH_KEY, token);
    storage.removeItem(PUSH_BINDING_KEY);
    return;
  }
  try {
    await removeCustomerPushDevice(accessToken, token);
    storage.removeItem(PUSH_BINDING_KEY);
    storage.removeItem(PUSH_DETACH_KEY);
  } catch {
    storage.setItem(PUSH_DETACH_KEY, token);
    storage.removeItem(PUSH_BINDING_KEY);
  }
}
