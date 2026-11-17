import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSession } from '../auth/sessionContext';
import { firebasePushConfigured, firebaseVapidKey, firebaseWebConfig } from '../config/firebaseWeb';
import {
  PUSH_PROMPT_KEY,
  pushDetachPending,
  readPushBinding,
  registerCustomerPushDevice,
  writePushBinding,
} from './pushApi';
import {
  accountIdFromAccessToken,
  customerPushVisible,
  deliveryPathFromPushData,
  foregroundNoticeKey,
  notificationPermission,
  pushCopy,
  pushRegistrationAction,
  shouldShowForegroundNotice,
} from './pushPolicy';
import { writePushAccount } from './pushAccount';

type Notice = { title: string; body: string; path: string | null };

export function CustomerPush() {
  const { status, accessToken } = useSession();
  const navigate = useNavigate();
  const [permission, setPermission] = useState(() => currentPermission());
  const [dismissed, setDismissed] = useState(promptDismissed);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (status !== 'signed-in' || permission !== 'granted' || !firebasePushConfigured()) return;
    let stopped = false;
    const refresh = () => {
      void registerCurrentToken(accessToken, () => stopped);
    };
    refresh();
    function onMessage(event: MessageEvent) {
      if (event.data?.type === 'riders-push-token-refresh') refresh();
      if (event.data?.type !== 'riders-open-delivery') return;
      const path = deliveryPathFromPushData({ deliveryId: pathId(event.data.path) });
      if (path) navigate(path);
    }
    navigator.serviceWorker?.addEventListener('message', onMessage);
    function onVisible() {
      if (document.visibilityState === 'visible') refresh();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      navigator.serviceWorker?.removeEventListener('message', onMessage);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [accessToken, navigate, permission, status]);

  useEffect(() => {
    if (status !== 'signed-in' || permission !== 'granted' || !firebasePushConfigured()) return;
    let stopped = false;
    let previousKey: string | null = null;
    let unsubscribe: () => void = () => undefined;
    void import('firebase/messaging').then(async ({ getMessaging, isSupported, onMessage }) => {
      if (stopped || !(await isSupported())) return;
      const config = firebaseWebConfig();
      if (!config) return;
      const { initializeApp, getApps } = await import('firebase/app');
      const app = getApps()[0] ?? initializeApp(config);
      unsubscribe = onMessage(getMessaging(app), (payload) => {
        void showForegroundNotice(payload, accessToken, () => stopped, previousKey, (key) => {
          previousKey = key;
        }, setNotice);
      });
    }).catch(() => undefined);
    return () => {
      stopped = true;
      unsubscribe();
    };
  }, [accessToken, permission, status]);

  if (status !== 'signed-in') return null;

  return (
    <>
      {permission === 'default' && !dismissed && firebasePushConfigured() ? (
        <div className="banner banner-push" role="status">
          <span>Get a message when a rider sends an offer, collects your parcel, or completes the delivery.</span>
          <span className="banner-push-actions">
            <button type="button" className="button" onClick={() => void enableNotifications(setPermission)}>
              Enable notifications
            </button>
            <button type="button" className="button button-secondary" onClick={() => dismissPrompt(setDismissed)}>
              Not now
            </button>
          </span>
        </div>
      ) : null}
      {notice ? (
        <div className="banner banner-push" role="status">
          <span><strong>{notice.title}</strong>{notice.body ? ` ${notice.body}` : ''}</span>
          {notice.path ? <Link to={notice.path} onClick={() => setNotice(null)}>Open delivery</Link> : null}
        </div>
      ) : null}
    </>
  );
}

async function enableNotifications(setPermission: (permission: ReturnType<typeof currentPermission>) => void): Promise<void> {
  if (typeof Notification === 'undefined' || !('serviceWorker' in navigator)) {
    setPermission('unsupported');
    return;
  }
  try {
    const result = await Notification.requestPermission();
    setPermission(result === 'granted' || result === 'denied' ? result : 'default');
  } catch {
    setPermission('denied');
  }
}

function promptDismissed(): boolean {
  try {
    return localStorage.getItem(PUSH_PROMPT_KEY) === 'dismissed';
  } catch {
    return false;
  }
}

function dismissPrompt(setDismissed: (dismissed: boolean) => void): void {
  localStorage.setItem(PUSH_PROMPT_KEY, 'dismissed');
  setDismissed(true);
}

async function registerCurrentToken(
  accessToken: () => Promise<string | null>,
  stopped: () => boolean,
): Promise<void> {
  if (!('serviceWorker' in navigator) || !firebasePushConfigured()) return;
  const registration = await serviceWorkerRegistration(stopped);
  if (!registration || stopped()) return;
  const token = await messagingToken(registration);
  const sessionToken = await accessToken();
  if (!token || !sessionToken || stopped()) return;
  const accountId = accountIdFromAccessToken(sessionToken);
  const action = pushRegistrationAction({
    signedIn: true,
    permission: 'granted',
    configured: true,
    accountId,
    token,
    binding: readPushBinding(localStorage),
    pendingDetach: pushDetachPending(localStorage),
  });
  if (action !== 'register' || !accountId) return;
  await registerCustomerPushDevice(sessionToken, token);
  if (stopped()) return;
  writePushBinding(localStorage, { accountId, token });
  await writePushAccount(accountId);
}

async function showForegroundNotice(
  payload: { messageId?: string; data?: Record<string, string>; notification?: { title?: string; body?: string } | null },
  accessToken: () => Promise<string | null>,
  stopped: () => boolean,
  previousKey: string | null,
  rememberKey: (key: string) => void,
  setNotice: (notice: Notice) => void,
): Promise<void> {
  if (stopped() || document.visibilityState !== 'visible') return;
  const copy = pushCopy(payload.data ?? payload);
  const sessionToken = await accessToken();
  if (stopped() || !sessionToken) return;
  if (!customerPushVisible(accountIdFromAccessToken(sessionToken), copy.accountId)) return;
  const key = foregroundNoticeKey(payload);
  if (!shouldShowForegroundNotice(previousKey, key, true) || !key) return;
  rememberKey(key);
  const path = deliveryPathFromPushData(payload.data);
  setNotice({
    title: copy.title ?? payload.notification?.title ?? 'Riders Delivery',
    body: copy.body ?? payload.notification?.body ?? '',
    path,
  });
}

async function serviceWorkerRegistration(stopped: () => boolean): Promise<ServiceWorkerRegistration | null> {
  const started = Date.now();
  while (!stopped() && Date.now() - started < 4_000) {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) return registration;
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
  return null;
}

async function messagingToken(registration: ServiceWorkerRegistration): Promise<string | null> {
  try {
    const { getMessaging, getToken, isSupported } = await import('firebase/messaging');
    if (!(await isSupported())) return null;
    const config = firebaseWebConfig();
    if (!config) return null;
    const { initializeApp, getApps } = await import('firebase/app');
    const app = getApps()[0] ?? initializeApp(config);
    return await getToken(getMessaging(app), {
      vapidKey: firebaseVapidKey(),
      serviceWorkerRegistration: registration,
    });
  } catch {
    return null;
  }
}

function currentPermission(): ReturnType<typeof notificationPermission> {
  return notificationPermission({
    notification: typeof Notification !== 'undefined',
    serviceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
    permission: typeof Notification === 'undefined' ? null : Notification.permission,
  });
}

function pathId(path: unknown): string | null {
  if (typeof path !== 'string') return null;
  const match = path.match(/^\/deliveries\/([A-Za-z0-9-]{1,80})$/);
  return match?.[1] ?? null;
}
