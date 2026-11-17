/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { initializeApp } from 'firebase/app';
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw';
import { firebaseVapidKey, firebaseWebConfig } from './config/firebaseWeb';
import { NAVIGATION_FALLBACK_DENYLIST } from './pwa/navigationFallback';
import { readPushAccount } from './pwa/pushAccount';
import {
  backgroundDisplaysAutomatically,
  backgroundNoticeAction,
  customerPushVisible,
  deliveryPathFromPushData,
  pushCopy,
} from './pwa/pushPolicy';

declare let self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), {
  denylist: [...NAVIGATION_FALLBACK_DENYLIST],
}));

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

self.addEventListener('notificationclick', (event) => {
  event.stopImmediatePropagation();
  event.notification.close();
  const path = deliveryPathFromPushData(event.notification.data);
  event.waitUntil(openDelivery(path));
});

self.addEventListener('pushsubscriptionchange', () => {
  void self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    clients.forEach((client) => client.postMessage({ type: 'riders-push-token-refresh' }));
  });
});

const firebaseConfig = firebaseWebConfig();
if (firebaseConfig && firebaseVapidKey()) {
  const messaging = getMessaging(initializeApp(firebaseConfig));
  onBackgroundMessage(messaging, async (payload) => {
    const copy = pushCopy(payload.data);
    const activeAccountId = await readPushAccount().catch(() => null);
    const action = backgroundNoticeAction({
      accountVisible: customerPushVisible(activeAccountId, copy.accountId),
      displaysAutomatically: backgroundDisplaysAutomatically(payload),
      hasTitle: Boolean(copy.title ?? payload.notification?.title),
    });
    if (action === 'close') {
      const shown = await self.registration.getNotifications();
      shown.forEach((notification) => notification.close());
      return;
    }
    if (action !== 'show') return;
    await self.registration.showNotification(copy.title ?? 'Riders Delivery', {
      body: copy.body ?? '',
      data: payload.data,
    });
  });
}

async function openDelivery(path: string | null): Promise<void> {
  const origin = new URL(self.registration.scope).origin;
  const target = path ? new URL(path, origin) : null;
  if (target && target.origin !== origin) return;
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const existing = clients.find((client) => {
    try {
      return new URL(client.url).origin === origin;
    } catch {
      return false;
    }
  });
  if (existing) {
    await existing.focus();
    if (target) existing.postMessage({ type: 'riders-open-delivery', path: target.pathname });
    return;
  }
  if (target) await self.clients.openWindow(target.href);
}
