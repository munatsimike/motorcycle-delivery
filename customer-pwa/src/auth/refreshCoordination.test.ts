import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canRefreshAfterUnauthorized,
  clearPersistedSession,
  readPersistedSession,
  readSession,
  sessionFromStorageValue,
  writePersistedSession,
  type AuthSession,
  type KeyValueStore,
} from './contracts.ts';
import {
  clearBlockedRefreshTokens,
  createCustomerRefresher,
  logoutUnderRefreshLock,
  queueRefreshLock,
  type CustomerRefreshShared,
} from './refreshCoordination.ts';

const now = Date.parse('2026-11-12T12:00:00.000Z');

test('two tabs refresh one token once and the second tab adopts the rotated session', async () => {
  let calls = 0;
  const { storage, openTab } = sharedTabs(async (token) => {
    calls += 1;
    assert.equal(token, 'refresh-1');
    return session('refresh-2', 'access-2');
  });
  writePersistedSession(session(), storage);
  const first = openTab();
  const second = openTab();
  const [left, right] = await Promise.all([
    first.refresh(session()),
    second.refresh(session()),
  ]);
  assert.equal(calls, 1);
  assert.equal(left.refreshToken, 'refresh-2');
  assert.equal(right.refreshToken, 'refresh-2');
  assert.equal(readPersistedSession(storage)?.accessToken, 'access-2');
});

test('one tab sends one refresh for overlapping requests', async () => {
  let calls = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { storage, openTab } = sharedTabs(async () => {
    calls += 1;
    await gate;
    return session('refresh-2', 'access-2');
  });
  writePersistedSession(session(), storage);
  const tab = openTab();
  const pending = Promise.all([tab.refresh(session()), tab.refresh(session())]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  release();
  const [left, right] = await pending;
  assert.equal(calls, 1);
  assert.equal(left.accessToken, right.accessToken);
});

test('a late rejected refresh does not delete a newer session', async () => {
  let removed = false;
  const { storage, openTab } = sharedTabs(async () => {
    writePersistedSession(session('refresh-2', 'access-2'), storage);
    const error = new Error('Authentication failed.');
    Object.assign(error, { status: 401 });
    throw error;
  }, () => {
    removed = true;
  });
  writePersistedSession(session(), storage);
  const adopted = await openTab().refresh(session());
  assert.equal(adopted.refreshToken, 'refresh-2');
  assert.equal(removed, false);
  assert.equal(readPersistedSession(storage)?.refreshToken, 'refresh-2');
});

test('logout clears the shared session for every tab', async () => {
  const { storage, lock } = sharedTabs(async () => session());
  writePersistedSession(session(), storage);
  blockToken(storage, 'refresh-1');
  let revoked: string | null = null;
  await logoutUnderRefreshLock({
    lock,
    read: () => readPersistedSession(storage),
    clear: () => {
      clearPersistedSession(storage);
      clearBlockedRefreshTokens(storage);
    },
    revoke: async (accessToken) => {
      revoked = accessToken;
    },
  });
  assert.equal(revoked, 'access-1');
  assert.equal(readPersistedSession(storage), null);
  assert.equal(sessionFromStorageValue(null), null);
  assert.equal(storage.getItem('riders.customer.refresh.blocked'), null);
});

test('a timed-out refresh is not sent again while the access token can still be used', async () => {
  let calls = 0;
  const { storage, openTab } = sharedTabs(async () => {
    calls += 1;
    throw new Error('The request timed out. Check your connection and try again.');
  });
  writePersistedSession(session(), storage);
  const first = await openTab().refresh(session());
  const second = await openTab().refresh(session());
  assert.equal(calls, 1);
  assert.equal(first.accessToken, 'access-1');
  assert.equal(second.accessToken, 'access-1');
  assert.equal(readPersistedSession(storage)?.refreshToken, 'refresh-1');
});

test('a closed PWA reopens the persisted session without another refresh', () => {
  const closed = memoryStore();
  writePersistedSession(session(), closed);
  const reopened = readPersistedSession(closed);
  assert.deepEqual(reopened, session());
});

test('WhatsApp login persists a session and authenticated calls can refresh once', () => {
  const storage = memoryStore();
  const signedIn = readSession({
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    accessTokenExpiresAt: '2026-11-12T12:20:00.000Z',
    refreshTokenExpiresAt: '2026-12-12T12:00:00.000Z',
  });
  writePersistedSession(signedIn, storage);
  assert.deepEqual(readPersistedSession(storage), signedIn);
  assert.equal(canRefreshAfterUnauthorized('/customers/me/deliveries', 401, false), true);
  assert.equal(canRefreshAfterUnauthorized('/customers/me/deliveries', 401, true), false);
  assert.equal(canRefreshAfterUnauthorized('/auth/customer/login/whatsapp/verify', 401, false), false);
  assert.equal(canRefreshAfterUnauthorized('/auth/session/refresh', 401, false), false);
});

test('a browser without a shared lock does not send a refresh', async () => {
  let calls = 0;
  const storage = memoryStore();
  writePersistedSession(session(), storage);
  const tab = createCustomerRefresher({
    getLock: () => null,
    read: () => readPersistedSession(storage),
    write: (next) => writePersistedSession(next, storage),
    remove: () => clearPersistedSession(storage),
    isBlocked: () => false,
    block: () => undefined,
    now: () => now,
    refresh: async () => {
      calls += 1;
      return session('refresh-2', 'access-2');
    },
  });
  const kept = await tab.refresh(session());
  assert.equal(calls, 0);
  assert.equal(kept.accessToken, 'access-1');
});

function sharedTabs(
  refresh: CustomerRefreshShared['refresh'],
  remove: () => void = () => undefined,
): {
  storage: KeyValueStore & { values: Map<string, string> };
  lock: ReturnType<typeof queueRefreshLock>;
  openTab: () => ReturnType<typeof createCustomerRefresher>;
} {
  const storage = memoryStore();
  const lock = queueRefreshLock();
  const blocked = new Set<string>();
  const shared: CustomerRefreshShared = {
    getLock: () => lock,
    read: () => readPersistedSession(storage),
    write: (next) => writePersistedSession(next, storage),
    remove: () => {
      remove();
      clearPersistedSession(storage);
    },
    isBlocked: (token) => blocked.has(token),
    block: (token) => {
      blocked.add(token);
    },
    now: () => now,
    refresh,
  };
  return {
    storage,
    lock,
    openTab: () => createCustomerRefresher(shared),
  };
}

function blockToken(storage: KeyValueStore, token: string): void {
  storage.setItem('riders.customer.refresh.blocked', JSON.stringify([token]));
}

function session(refreshToken = 'refresh-1', accessToken = 'access-1'): AuthSession {
  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: '2026-11-12T12:20:00.000Z',
    refreshTokenExpiresAt: '2026-12-12T12:00:00.000Z',
  };
}

function memoryStore(): KeyValueStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}
