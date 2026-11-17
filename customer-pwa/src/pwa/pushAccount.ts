const DATABASE = 'riders-customer-push';
const STORE = 'account';
const KEY = 'active';

export async function writePushAccount(accountId: string): Promise<void> {
  const database = await openPushAccountDb();
  await requestToPromise(database.transaction(STORE, 'readwrite').objectStore(STORE).put(accountId, KEY));
  database.close();
}

export async function clearPushAccount(): Promise<void> {
  const database = await openPushAccountDb();
  await requestToPromise(database.transaction(STORE, 'readwrite').objectStore(STORE).delete(KEY));
  database.close();
}

export async function readPushAccount(): Promise<string | null> {
  const database = await openPushAccountDb();
  const value = await requestToPromise(database.transaction(STORE, 'readonly').objectStore(STORE).get(KEY));
  database.close();
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function openPushAccountDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Push account storage failed'));
  });
}

function requestToPromise(request: IDBRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Push account storage failed'));
  });
}
