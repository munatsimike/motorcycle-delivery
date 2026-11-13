import { registerSW } from 'virtual:pwa-register';

type UpdateListener = (reload: () => void) => void;

const listeners = new Set<UpdateListener>();
let pendingReload: (() => void) | null = null;

export const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    pendingReload = () => {
      void updateSW(true);
    };
    listeners.forEach((listener) => listener(pendingReload!));
  },
});

export function subscribeToAppUpdate(listener: UpdateListener): () => void {
  listeners.add(listener);
  if (pendingReload) {
    listener(pendingReload);
  }
  return () => {
    listeners.delete(listener);
  };
}
