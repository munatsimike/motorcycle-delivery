import type { CustomerPush } from './customerPush';

export type PushLaunch = {
  interactionId: string;
  push: CustomerPush;
};

export function createPushInteractions() {
  const seen = new Set<string>();
  let pending: PushLaunch | null = null;

  return {
    accept(interactionId: string, push: CustomerPush | null): 'ignored' | 'duplicate' | 'deferred' {
      if (!push) {
        return 'ignored';
      }
      if (!interactionId || seen.has(interactionId)) {
        return 'duplicate';
      }
      seen.add(interactionId);
      pending = { interactionId, push };
      return 'deferred';
    },
    take(signedIn: boolean, navigationReady: boolean): PushLaunch | null {
      if (!pending || !signedIn || !navigationReady) {
        return null;
      }
      const launch = pending;
      pending = null;
      return launch;
    },
  };
}
