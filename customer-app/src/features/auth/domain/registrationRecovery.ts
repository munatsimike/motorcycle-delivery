export type RegistrationDraft = {
  fullName: string;
  address: string;
};

export type RegistrationProofRecord = {
  registrationToken: string;
  expiresAt: string;
};

export type RegistrationRecoveryState = {
  proof: RegistrationProofRecord | null;
  draft: RegistrationDraft;
};

export type RegistrationDestination =
  | { kind: 'form'; registrationToken: string; fullName: string; address: string }
  | { kind: 'otp'; fullName: string; address: string }
  | { kind: 'start'; fullName: string; address: string };

export const EMPTY_REGISTRATION_DRAFT: RegistrationDraft = {
  fullName: '',
  address: '',
};

export function verifiedRegistrationPhone(token: string): string | null {
  const parsed = registrationProofPayload(token);
  if (!parsed || typeof parsed.phone !== 'string') {
    return null;
  }
  const phone = parsed.phone.trim();
  return phone || null;
}

export function proofExpiryMs(token: string): number | null {
  const parsed = registrationProofPayload(token);
  if (!parsed || typeof parsed.exp !== 'number' || !Number.isFinite(parsed.exp)) {
    return null;
  }
  return parsed.exp * 1000;
}

function registrationProofPayload(token: string): Record<string, unknown> | null {
  const payload = token.split('.')[1];
  if (!payload) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(decodeBase64Url(payload));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function storeProof(token: string): RegistrationProofRecord | null {
  const expiresAtMs = proofExpiryMs(token);
  if (expiresAtMs === null) {
    return null;
  }
  return {
    registrationToken: token,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

export function proofValidUntil(proof: RegistrationProofRecord): number | null {
  const tokenExpiresAt = proofExpiryMs(proof.registrationToken);
  const storedExpiresAt = Date.parse(proof.expiresAt);
  if (tokenExpiresAt === null || !Number.isFinite(storedExpiresAt)) {
    return null;
  }
  return Math.min(tokenExpiresAt, storedExpiresAt);
}

export function registrationDestination(
  proof: RegistrationProofRecord | null,
  draft: RegistrationDraft,
  now: number,
): RegistrationDestination {
  if (!proof) {
    return { kind: 'start', fullName: draft.fullName, address: draft.address };
  }
  const validUntil = proofValidUntil(proof);
  if (validUntil === null || validUntil <= now) {
    return { kind: 'otp', fullName: draft.fullName, address: draft.address };
  }
  return {
    kind: 'form',
    registrationToken: proof.registrationToken,
    fullName: draft.fullName,
    address: draft.address,
  };
}

export function withRegistrationDraft(
  state: RegistrationRecoveryState,
  draft: RegistrationDraft,
): RegistrationRecoveryState {
  return { proof: state.proof, draft };
}

export function registrationAfterHardwareBack(state: RegistrationRecoveryState): RegistrationRecoveryState {
  return state;
}

export function formSeed(
  draft: RegistrationDraft,
  server: { fullName?: string; address?: string | null },
): RegistrationDraft {
  return {
    fullName: draft.fullName.trim() || server.fullName?.trim() || '',
    address: draft.address.trim() || (typeof server.address === 'string' ? server.address.trim() : ''),
  };
}

export function createSingleFlight() {
  let active = false;
  return {
    enter(): boolean {
      if (active) {
        return false;
      }
      active = true;
      return true;
    },
    leave() {
      active = false;
    },
  };
}

export type SubmissionFailure = 'interrupted' | 'rejected';

export function registrationAfterSubmissionFailure(
  failure: SubmissionFailure,
  state: RegistrationRecoveryState,
): { stayOnForm: boolean; state: RegistrationRecoveryState } {
  if (failure === 'interrupted') {
    return { stayOnForm: true, state };
  }
  return {
    stayOnForm: false,
    state: { proof: null, draft: state.draft },
  };
}

function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  if (typeof globalThis.atob === 'function') {
    return globalThis.atob(padded);
  }
  return '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
