import * as SecureStore from 'expo-secure-store';

import {
  EMPTY_REGISTRATION_DRAFT,
  registrationDestination,
  storeProof,
  type RegistrationDestination,
  type RegistrationDraft,
  type RegistrationProofRecord,
} from '../domain/registrationRecovery';

const PROOF_KEY = 'riders.customer.registration.proof';
const DRAFT_KEY = 'riders.customer.registration.draft';

const secureOptions = {
  keychainService: 'riders.customer.registration',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export async function rememberRegistrationProof(token: string): Promise<void> {
  const proof = storeProof(token);
  if (!proof) {
    return;
  }
  await SecureStore.setItemAsync(PROOF_KEY, JSON.stringify(proof), secureOptions);
}

export async function rememberRegistrationDraft(draft: RegistrationDraft): Promise<void> {
  await SecureStore.setItemAsync(DRAFT_KEY, JSON.stringify({
    fullName: draft.fullName,
    address: draft.address,
  }), secureOptions);
}

export async function loadRegistrationDraft(): Promise<RegistrationDraft> {
  return readDraft();
}

export async function loadRegistrationDestination(now = Date.now()): Promise<RegistrationDestination> {
  const proof = await readProof();
  const draft = await readDraft();
  const destination = registrationDestination(proof, draft, now);
  if (proof && destination.kind !== 'form') {
    await clearRegistrationProof();
  }
  return destination;
}

export async function clearRegistrationProof(): Promise<void> {
  await SecureStore.deleteItemAsync(PROOF_KEY, secureOptions).catch(() => undefined);
}

export async function clearRegistrationRecovery(): Promise<void> {
  await Promise.all([
    clearRegistrationProof(),
    SecureStore.deleteItemAsync(DRAFT_KEY, secureOptions).catch(() => undefined),
  ]);
}

async function readProof(): Promise<RegistrationProofRecord | null> {
  try {
    const raw = await SecureStore.getItemAsync(PROOF_KEY, secureOptions);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed.registrationToken !== 'string' || typeof parsed.expiresAt !== 'string') {
      await clearRegistrationProof();
      return null;
    }
    if (!parsed.registrationToken || !parsed.expiresAt) {
      await clearRegistrationProof();
      return null;
    }
    return { registrationToken: parsed.registrationToken, expiresAt: parsed.expiresAt };
  } catch {
    await clearRegistrationProof();
    return null;
  }
}

async function readDraft(): Promise<RegistrationDraft> {
  try {
    const raw = await SecureStore.getItemAsync(DRAFT_KEY, secureOptions);
    if (!raw) {
      return EMPTY_REGISTRATION_DRAFT;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return EMPTY_REGISTRATION_DRAFT;
    }
    return {
      fullName: typeof parsed.fullName === 'string' ? parsed.fullName : '',
      address: typeof parsed.address === 'string' ? parsed.address : '',
    };
  } catch {
    return EMPTY_REGISTRATION_DRAFT;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
