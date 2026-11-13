import type { KeyValueStore } from './acceptanceKeys';

const STORAGE_KEY = 'customer_delivery_create_v1';

export type BookingAttempts = {
  keyFor(fingerprint: string, createKey: () => string): Promise<string>;
  clear(): Promise<void>;
};

type SavedAttempt = {
  fingerprint: string;
  key: string;
};

export function createBookingAttempts(storage: KeyValueStore): BookingAttempts {
  let tail = Promise.resolve();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work, work);
    tail = run.then(() => undefined, () => undefined);
    return run;
  };

  return {
    keyFor(fingerprint, createKey) {
      return enqueue(async () => {
        const saved = await read(storage);
        if (saved?.fingerprint === fingerprint) {
          return saved.key;
        }
        const key = createKey().trim();
        if (!key || key.length > 200) {
          throw new Error('The delivery could not be booked.');
        }
        const next: SavedAttempt = { fingerprint, key };
        await storage.setItem(STORAGE_KEY, JSON.stringify(next));
        return key;
      });
    },
    clear() {
      return enqueue(async () => {
        await storage.setItem(STORAGE_KEY, '');
      });
    },
  };
}

async function read(storage: KeyValueStore): Promise<SavedAttempt | null> {
  const raw = await storage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isAttempt(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isAttempt(value: unknown): value is SavedAttempt {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as { fingerprint?: unknown; key?: unknown };
  return typeof record.fingerprint === 'string'
    && record.fingerprint.length > 0
    && typeof record.key === 'string'
    && record.key.trim().length > 0
    && record.key.trim().length <= 200;
}
