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

export async function removePushRegistration(input: {
  accessToken: string | null;
  store: PushRegistrationStore;
  remove(accessToken: string, token: string): Promise<void>;
}): Promise<'skipped' | 'removed' | 'failed'> {
  const saved = await input.store.load();
  if (!saved || !input.accessToken) {
    return 'skipped';
  }
  try {
    await input.remove(input.accessToken, saved.token);
  } catch {
    return 'failed';
  }
  await input.store.clear();
  return 'removed';
}

export const PUSH_DEREGISTER_FAILED = 'This device could not be removed from delivery alerts.';
