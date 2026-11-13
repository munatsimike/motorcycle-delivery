export const BOOKING_STEPS = ['pickup', 'destination', 'parcel', 'review', 'confirm'] as const;
export type BookingStep = (typeof BOOKING_STEPS)[number];
export type BookingBusy = 'quote' | 'create' | 'locate' | null;

const STEP_LABELS: Record<BookingStep, string> = {
  pickup: 'Pickup',
  destination: 'Drop-off',
  parcel: 'Parcel details',
  review: 'Review',
  confirm: 'Confirm',
};

export function bookingStepTitle(step: BookingStep): string {
  return STEP_LABELS[step];
}

export function bookingStepIndex(step: BookingStep): number {
  return BOOKING_STEPS.indexOf(step);
}

export function previousBookingStep(step: BookingStep): BookingStep {
  const index = BOOKING_STEPS.indexOf(step);
  return BOOKING_STEPS[Math.max(0, index - 1)] ?? 'pickup';
}

export function nextBookingStep(step: BookingStep): BookingStep {
  const index = BOOKING_STEPS.indexOf(step);
  return BOOKING_STEPS[Math.min(BOOKING_STEPS.length - 1, index + 1)] ?? step;
}

export function bookingBackAction(step: BookingStep, busy: BookingBusy): 'blocked' | 'previous' | 'exit' {
  if (busy) return 'blocked';
  return step === 'pickup' ? 'exit' : 'previous';
}

export function canStartBookingSubmit(creating: boolean, busy: BookingBusy): boolean {
  return !creating && busy === null;
}

export function bookingNavigationDelay(reduceMotion: boolean): number {
  return reduceMotion ? 0 : 380;
}

export function bookingMode(enabled: boolean | null): 'v2' | 'unavailable' | 'unknown' {
  if (enabled === true) return 'v2';
  if (enabled === false) return 'unavailable';
  return 'unknown';
}

export type AttemptStore = {
  get(): string | null;
  set(value: string): void;
};

type SavedAttempt = { fingerprint: string; key: string };

export function bookingKeyFor(store: AttemptStore, fingerprint: string, createKey: () => string): string {
  const saved = readAttempt(store.get());
  if (saved?.fingerprint === fingerprint) return saved.key;
  const key = createKey().trim();
  if (!key || key.length > 200) throw new Error('The delivery could not be booked.');
  store.set(JSON.stringify({ fingerprint, key }));
  return key;
}

export function clearBookingAttempt(store: AttemptStore): void {
  store.set('');
}

export function memoryAttemptStore(): AttemptStore {
  let value: string | null = null;
  return {
    get: () => value,
    set: (next) => { value = next; },
  };
}

type AttemptStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function persistentAttemptStore(storage: AttemptStorage, storageKey: string): AttemptStore {
  return {
    get() {
      try {
        return storage.getItem(storageKey);
      } catch {
        return null;
      }
    },
    set(value: string) {
      try {
        if (!value) storage.removeItem(storageKey);
        else storage.setItem(storageKey, value);
      } catch {
        // The booking can still be sent. A later retry may use a new key.
      }
    },
  };
}

function readAttempt(raw: string | null): SavedAttempt | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed.fingerprint !== 'string' || !parsed.fingerprint) return null;
    if (typeof parsed.key !== 'string' || !parsed.key.trim() || parsed.key.trim().length > 200) return null;
    return { fingerprint: parsed.fingerprint, key: parsed.key };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
