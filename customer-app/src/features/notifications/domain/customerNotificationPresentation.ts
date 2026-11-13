import { foregroundNotificationBehavior } from './customerPush';

export type NotificationPresentationHost = {
  setNotificationHandler: (handler: {
    handleNotification: () => Promise<ReturnType<typeof foregroundNotificationBehavior>>;
  }) => void;
};

export function createCustomerNotificationPresentation(host: NotificationPresentationHost) {
  let installed = false;
  return {
    install(): void {
      if (installed) {
        return;
      }
      installed = true;
      host.setNotificationHandler({
        handleNotification: async () => foregroundNotificationBehavior(),
      });
    },
    installed(): boolean {
      return installed;
    },
  };
}

let presentation: ReturnType<typeof createCustomerNotificationPresentation> | null = null;

export function installCustomerNotificationHandler(host: NotificationPresentationHost): void {
  if (!presentation) {
    presentation = createCustomerNotificationPresentation(host);
  }
  presentation.install();
}
