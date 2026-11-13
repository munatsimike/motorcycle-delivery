export type StoredProof = {
  registrationToken: string;
  expiresAt: string;
  fullName: string;
  address: string;
};

const STORAGE_KEY = 'riders.customer.registration';

export function proofExpiryMs(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(decodeBase64Url(payload));
    if (!isRecord(parsed) || typeof parsed.exp !== 'number' || !Number.isFinite(parsed.exp)) {
      return null;
    }
    return parsed.exp * 1000;
  } catch {
    return null;
  }
}

export function verifiedRegistrationPhone(token: string): string | null {
  const payload = token.split('.')[1];
  if (!payload) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(decodeBase64Url(payload));
    if (!isRecord(parsed) || typeof parsed.phone !== 'string') {
      return null;
    }
    const phone = parsed.phone.trim();
    return phone || null;
  } catch {
    return null;
  }
}

export function storeProof(token: string, fullName = '', address = ''): StoredProof | null {
  const expiresAtMs = proofExpiryMs(token);
  if (expiresAtMs === null) {
    return null;
  }
  return {
    registrationToken: token,
    expiresAt: new Date(expiresAtMs).toISOString(),
    fullName,
    address,
  };
}

export function proofStillValid(proof: StoredProof, now: number): boolean {
  const tokenExpiresAt = proofExpiryMs(proof.registrationToken);
  const storedExpiresAt = Date.parse(proof.expiresAt);
  if (tokenExpiresAt === null || !Number.isFinite(storedExpiresAt)) {
    return false;
  }
  return Math.min(tokenExpiresAt, storedExpiresAt) > now;
}

export function saveRegistrationProof(proof: StoredProof): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
    registrationToken: proof.registrationToken,
    expiresAt: proof.expiresAt,
    fullName: proof.fullName,
    address: proof.address,
  }));
}

export function readRegistrationProof(now = Date.now()): StoredProof | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed.registrationToken !== 'string' || typeof parsed.expiresAt !== 'string') {
      clearRegistrationProof();
      return null;
    }
    const proof: StoredProof = {
      registrationToken: parsed.registrationToken,
      expiresAt: parsed.expiresAt,
      fullName: typeof parsed.fullName === 'string' ? parsed.fullName : '',
      address: typeof parsed.address === 'string' ? parsed.address : '',
    };
    if (!proofStillValid(proof, now)) {
      clearRegistrationProof();
      return null;
    }
    return proof;
  } catch {
    return null;
  }
}

export function clearRegistrationProof(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
