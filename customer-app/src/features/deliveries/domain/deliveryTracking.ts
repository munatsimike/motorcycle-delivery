import { deliveryGroup, type DeliveryStatus } from './deliveryStatus';
import type { CustomerDeliveryDetail } from './customerDeliveryDetail';

export type TrackingClock = {
  schedule(callback: () => void, delayMs: number): void;
  clear(): void;
};

export type TrackingSnapshot = {
  delivery: CustomerDeliveryDetail | null;
  error: string | null;
  isLoading: boolean;
};

type TrackerOptions = {
  load(): Promise<CustomerDeliveryDetail>;
  clock: TrackingClock;
  isAuthError(error: unknown): boolean;
  errorText(error: unknown): string;
  onChange(snapshot: TrackingSnapshot): void;
  appActive?: boolean;
};

export function isTerminalDeliveryStatus(status: DeliveryStatus): boolean {
  return deliveryGroup(status) === 'history';
}

export function createDeliveryTracker(options: TrackerOptions) {
  let focused = false;
  let appActive = options.appActive ?? true;
  let delivery: CustomerDeliveryDetail | null = null;
  let error: string | null = null;
  let isLoading = false;
  let inFlight = false;
  let authFailed = false;
  let disposed = false;
  let generation = 0;
  let published = '';

  function snapshot(): TrackingSnapshot {
    return { delivery, error, isLoading };
  }

  function publish() {
    const next = JSON.stringify(snapshot());
    if (next === published) {
      return;
    }
    published = next;
    options.onChange(snapshot());
  }

  function watching(): boolean {
    return focused && appActive && !authFailed && !disposed && !isTerminal(delivery);
  }

  function arm() {
    options.clock.clear();
  }

  async function refresh(manual: boolean) {
    if (disposed || inFlight) {
      return;
    }
    if (manual) {
      authFailed = false;
    }
    inFlight = true;
    const current = generation + 1;
    generation = current;
    if (!delivery) {
      isLoading = true;
    }
    publish();
    try {
      const loaded = await options.load();
      if (disposed || current !== generation) {
        return;
      }
      delivery = loaded;
      error = null;
      authFailed = false;
    } catch (caught: unknown) {
      if (disposed || current !== generation) {
        return;
      }
      if (options.isAuthError(caught)) {
        authFailed = true;
      }
      if (!error) {
        error = options.errorText(caught);
      }
    } finally {
      if (current === generation) {
        inFlight = false;
        isLoading = false;
        if (!disposed) {
          publish();
          arm();
        }
      }
    }
  }

  return {
    setAppActive(next: boolean) {
      if (disposed || appActive === next) {
        return;
      }
      appActive = next;
      if (watching()) {
        void refresh(false);
        return;
      }
      options.clock.clear();
    },
    setFocused(next: boolean) {
      if (disposed || focused === next) {
        return;
      }
      focused = next;
      if (watching()) {
        void refresh(false);
        return;
      }
      options.clock.clear();
    },
    refresh() {
      void refresh(true);
    },
    stop() {
      disposed = true;
      generation += 1;
      inFlight = false;
      options.clock.clear();
    },
  };
}

function isTerminal(delivery: CustomerDeliveryDetail | null): boolean {
  return delivery !== null && isTerminalDeliveryStatus(delivery.status);
}
