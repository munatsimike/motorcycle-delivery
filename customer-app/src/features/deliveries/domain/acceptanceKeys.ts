export type KeyValueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

const STORAGE_KEY = 'customer_bid_acceptance_v1';

export type AcceptanceKeys = {
  keyFor(deliveryId: string, bidId: string, createKey: () => string): Promise<string>;
  clear(deliveryId: string, bidId: string): Promise<void>;
};

export function createAcceptanceKeys(storage: KeyValueStore): AcceptanceKeys {
  return {
    async keyFor(deliveryId, bidId, createKey) {
      const saved = await read(storage);
      const id = attemptId(deliveryId, bidId);
      const existing = saved[id];
      if (existing) {
        return existing;
      }
      const key = createKey().trim();
      if (!key || key.length > 200) {
        throw new Error('This bid could not be accepted.');
      }
      saved[id] = key;
      await storage.setItem(STORAGE_KEY, JSON.stringify(saved));
      return key;
    },
    async clear(deliveryId, bidId) {
      const saved = await read(storage);
      delete saved[attemptId(deliveryId, bidId)];
      await storage.setItem(STORAGE_KEY, JSON.stringify(saved));
    },
  };
}

function attemptId(deliveryId: string, bidId: string): string {
  return `${deliveryId}:${bidId}`;
}

async function read(storage: KeyValueStore): Promise<Record<string, string>> {
  const raw = await storage.getItem(STORAGE_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return {};
    }
    const keys: Record<string, string> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.trim()) {
        keys[id] = value;
      }
    }
    return keys;
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
