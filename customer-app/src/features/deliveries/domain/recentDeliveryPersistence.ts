import {
  readRecentDeliverySnapshot,
  splitSecureValue,
  type RecentDeliverySnapshot,
} from './recentDeliveryCache';
import {
  CUSTOMER_IDENTITY_VERSION,
  readCustomerIdentity,
  type CustomerIdentity,
} from '../../../services/session/customerIdentity';

export type KeyValueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
};

const CACHE_PREFIX = 'riders.customer.deliveries.';
const IDENTITY_KEY = 'riders.customer.identity';

export function createRecentDeliveryPersistence(store: KeyValueStore) {
  return {
    async load(customerId: string): Promise<RecentDeliverySnapshot | null> {
      try {
        const raw = await readChunked(store, cacheKey(customerId));
        if (!raw) {
          return null;
        }
        const snapshot = readRecentDeliverySnapshot(JSON.parse(raw) as unknown, customerId);
        if (!snapshot) {
          await deleteChunked(store, cacheKey(customerId));
        }
        return snapshot;
      } catch {
        await deleteChunked(store, cacheKey(customerId));
        return null;
      }
    },
    async save(snapshot: RecentDeliverySnapshot): Promise<void> {
      await writeChunked(store, cacheKey(snapshot.customerId), JSON.stringify(snapshot));
    },
    async clear(customerId: string): Promise<void> {
      await deleteChunked(store, cacheKey(customerId));
    },
  };
}

export function createCustomerIdentityPersistence(store: KeyValueStore) {
  return {
    async load(): Promise<CustomerIdentity | null> {
      try {
        const raw = await store.getItem(IDENTITY_KEY);
        if (!raw) {
          return null;
        }
        const identity = readCustomerIdentity(JSON.parse(raw) as unknown);
        if (!identity) {
          await store.deleteItem(IDENTITY_KEY);
        }
        return identity;
      } catch {
        await store.deleteItem(IDENTITY_KEY);
        return null;
      }
    },
    async save(identity: CustomerIdentity): Promise<void> {
      await store.setItem(IDENTITY_KEY, JSON.stringify({
        schemaVersion: CUSTOMER_IDENTITY_VERSION,
        customerId: identity.customerId,
        sessionKey: identity.sessionKey,
      }));
    },
    async clear(): Promise<void> {
      await store.deleteItem(IDENTITY_KEY);
    },
  };
}

function cacheKey(customerId: string): string {
  return `${CACHE_PREFIX}${encodeURIComponent(customerId.trim())}`;
}

async function readChunked(store: KeyValueStore, key: string): Promise<string | null> {
  const metaRaw = await store.getItem(key);
  if (!metaRaw) {
    return null;
  }
  const meta = JSON.parse(metaRaw) as unknown;
  if (!isMeta(meta)) {
    return null;
  }
  const parts: string[] = [];
  for (let index = 0; index < meta.parts; index += 1) {
    const part = await store.getItem(`${key}.${index}`);
    if (part === null) {
      return null;
    }
    parts.push(part);
  }
  return parts.join('');
}

async function writeChunked(store: KeyValueStore, key: string, value: string): Promise<void> {
  const parts = splitSecureValue(value);
  const previous = await store.getItem(key);
  await store.setItem(key, JSON.stringify({ parts: parts.length }));
  for (let index = 0; index < parts.length; index += 1) {
    await store.setItem(`${key}.${index}`, parts[index] ?? '');
  }
  const previousCount = previousMetaCount(previous);
  for (let index = parts.length; index < previousCount; index += 1) {
    await store.deleteItem(`${key}.${index}`);
  }
}

async function deleteChunked(store: KeyValueStore, key: string): Promise<void> {
  const previous = await store.getItem(key).catch(() => null);
  const count = previousMetaCount(previous);
  await store.deleteItem(key);
  for (let index = 0; index < count; index += 1) {
    await store.deleteItem(`${key}.${index}`);
  }
}

function previousMetaCount(raw: string | null): number {
  if (!raw) {
    return 0;
  }
  try {
    const meta = JSON.parse(raw) as unknown;
    return isMeta(meta) ? meta.parts : 0;
  } catch {
    return 0;
  }
}

function isMeta(value: unknown): value is { parts: number } {
  return typeof value === 'object'
    && value !== null
    && 'parts' in value
    && typeof value.parts === 'number'
    && Number.isInteger(value.parts)
    && value.parts >= 0
    && value.parts <= 50;
}
