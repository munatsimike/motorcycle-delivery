export type PushRegistration = {
  customerId: string;
  token: string;
};

export type PushRegistrationStore = {
  load(): Promise<PushRegistration | null>;
  save(registration: PushRegistration): Promise<void>;
  clear(): Promise<void>;
};

export function registrationDecision(
  saved: PushRegistration | null,
  customerId: string,
  token: string,
): 'skip' | 'register' {
  if (saved && saved.customerId === customerId && saved.token === token) {
    return 'skip';
  }
  return 'register';
}

export async function syncPushRegistration(input: {
  accessToken: string;
  customerId: string;
  token: string;
  store: PushRegistrationStore;
  register(accessToken: string, token: string): Promise<'registered' | 'unavailable'>;
}): Promise<'skipped' | 'registered' | 'unavailable' | 'failed'> {
  const saved = await input.store.load();
  if (registrationDecision(saved, input.customerId, input.token) === 'skip') {
    return 'skipped';
  }
  try {
    const outcome = await input.register(input.accessToken, input.token);
    if (outcome === 'unavailable') {
      return 'unavailable';
    }
    await input.store.save({ customerId: input.customerId, token: input.token });
    return 'registered';
  } catch {
    return 'failed';
  }
}

export type PushRemoval = 'skipped' | 'removed' | 'unauthorized' | 'failed';

export async function removePushRegistration(input: {
  accessToken: string | null;
  store: PushRegistrationStore;
  remove(accessToken: string, token: string): Promise<void>;
}): Promise<PushRemoval> {
  let saved: PushRegistration | null;
  try {
    saved = await input.store.load();
  } catch {
    return 'failed';
  }
  if (!saved || !saved.token.trim() || !input.accessToken) {
    return 'skipped';
  }
  try {
    await input.remove(input.accessToken, saved.token);
  } catch (error) {
    if (isUnauthorized(error)) {
      await clearLocalRegistration(input.store);
      return 'unauthorized';
    }
    return 'failed';
  }
  await clearLocalRegistration(input.store);
  return 'removed';
}

async function clearLocalRegistration(store: PushRegistrationStore): Promise<void> {
  try {
    await store.clear();
  } catch {
    // Local sign-out still continues when the saved token cannot be erased.
  }
}

function isUnauthorized(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return false;
  }
  const status = error.status;
  return status === 401 || status === 403;
}
