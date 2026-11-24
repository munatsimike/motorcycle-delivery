export const SUCCESS_TOAST_DISMISS_MS = 3_000;
export const SUCCESS_TOAST_MOTION_MS = 280;

export type SuccessToastEvent = {
  id: string;
  message: string;
};

export function deliveryCancelledToast(deliveryId: string): SuccessToastEvent {
  return { id: `delivery-cancelled:${deliveryId}`, message: 'Delivery cancelled' };
}

export function riderConfirmedToast(deliveryId: string): SuccessToastEvent {
  return { id: `rider-confirmed:${deliveryId}`, message: 'Rider confirmed!' };
}

export function acceptToast(eventId: string, consumedIds: ReadonlySet<string>): string | null {
  const id = eventId.trim();
  if (!id || consumedIds.has(id)) return null;
  return id;
}

export function toastDismissed(shownAtMs: number, nowMs: number, dismissMs = SUCCESS_TOAST_DISMISS_MS): boolean {
  return nowMs - shownAtMs >= dismissMs;
}

let current: SuccessToastEvent | null = null;
const consumed = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function showSuccessToast(event: SuccessToastEvent): boolean {
  if (!event.message.trim()) return false;
  const accepted = acceptToast(event.id, consumed);
  if (!accepted) return false;
  consumed.add(accepted);
  current = { id: accepted, message: event.message };
  emit();
  return true;
}

export function dismissSuccessToast(id: string) {
  if (current?.id !== id) return;
  current = null;
  emit();
}

export function currentSuccessToast(): SuccessToastEvent | null {
  return current;
}

export function subscribeSuccessToast(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetSuccessToastForTests() {
  current = null;
  consumed.clear();
  emit();
}
