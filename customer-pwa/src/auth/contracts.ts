export type AuthFlow = 'whatsapp_login' | 'whatsapp_registration';

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
};

export type LoginStart =
  | { status: 'pending' }
  | { status: 'unavailable' };

export type RegistrationProof = {
  status: 'verified';
  registrationToken: string;
  fullName?: string;
  address?: string | null;
};

export type RegistrationVerification =
  | RegistrationProof
  | { status: 'sign_in' }
  | AuthSession;

export type CustomerAccount = {
  id: string | null;
  kind: 'INDIVIDUAL' | 'BUSINESS';
  name: string;
  contactName: string | null;
  phone: string;
  address: string;
  email: string | null;
  hasProfilePhoto: boolean;
  marketplaceEnabled: boolean;
};

const REFRESH_WINDOW_MS = 30_000;

export function readLoginStart(value: unknown): LoginStart {
  if (!isRecord(value)) {
    throw new Error('Verification could not be started.');
  }
  if (value.status === 'pending') {
    return { status: 'pending' };
  }
  if (value.status === 'unavailable') {
    return { status: 'unavailable' };
  }
  throw new Error('Verification could not be started.');
}

export function readPending(value: unknown): void {
  if (!isRecord(value) || value.status !== 'pending') {
    throw new Error('Verification could not be started.');
  }
}

export function readVerification(value: unknown): RegistrationVerification {
  if (!isRecord(value)) {
    throw new Error('Authentication failed.');
  }
  if (value.status === 'sign_in') {
    return { status: 'sign_in' };
  }
  const registrationToken = textField(value.registrationToken);
  if (value.status === 'verified' && registrationToken) {
    const fullName = textField(value.fullName) ?? undefined;
    const address = value.address === null ? null : textField(value.address) ?? undefined;
    return { status: 'verified', registrationToken, fullName, address };
  }
  return readSession(value);
}

export function readSession(value: unknown): AuthSession {
  if (!isRecord(value)) {
    throw new Error('Authentication failed.');
  }
  const accessToken = textField(value.accessToken);
  const refreshToken = textField(value.refreshToken);
  const accessTokenExpiresAt = textField(value.accessTokenExpiresAt);
  const refreshTokenExpiresAt = textField(value.refreshTokenExpiresAt);
  if (!accessToken || !refreshToken || !accessTokenExpiresAt || !refreshTokenExpiresAt) {
    throw new Error('Authentication failed.');
  }
  return { accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt };
}

export function readCustomerAccount(value: unknown): CustomerAccount {
  if (!isRecord(value)) {
    throw new Error('Account details are unavailable.');
  }
  const kind = value.kind === 'BUSINESS' ? 'BUSINESS' : value.kind === 'INDIVIDUAL' ? 'INDIVIDUAL' : null;
  const name = textField(value.name);
  const phone = textField(value.phone);
  const address = textField(value.address);
  const contactName = value.contactName === null ? null : textField(value.contactName);
  if (!kind || !name || !phone || !address || contactName === undefined) {
    throw new Error('Account details are unavailable.');
  }
  if (typeof value.marketplaceEnabled !== 'boolean') {
    throw new Error('Account details are unavailable.');
  }
  const email = readEmail(value.email);
  return {
    id: textField(value.id),
    kind,
    name,
    contactName,
    phone,
    address,
    email,
    hasProfilePhoto: value.hasProfilePhoto === true,
    marketplaceEnabled: value.marketplaceEnabled,
  };
}

function readEmail(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const email = textField(value);
  if (!email) throw new Error('Account details are unavailable.');
  return email;
}

export function accessNeedsRefresh(session: AuthSession, now: number): boolean {
  const expiresAt = Date.parse(session.accessTokenExpiresAt);
  return !Number.isFinite(expiresAt) || expiresAt - now <= REFRESH_WINDOW_MS;
}

export type RestorePlan =
  | { action: 'signed-out' }
  | { action: 'use' }
  | { action: 'refresh' };

export function planSessionRestore(session: AuthSession | null, now: number): RestorePlan {
  if (!session) {
    return { action: 'signed-out' };
  }
  const refreshExpiresAt = Date.parse(session.refreshTokenExpiresAt);
  if (!Number.isFinite(refreshExpiresAt) || refreshExpiresAt <= now) {
    return { action: 'signed-out' };
  }
  if (!accessNeedsRefresh(session, now)) {
    return { action: 'use' };
  }
  return { action: 'refresh' };
}

export function isSessionRejection(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return false;
  }
  const status = error.status;
  return status === 401 || status === 403;
}

export function isRefreshTransportFailure(error: unknown): boolean {
  return error instanceof Error
    && (error.message.startsWith('The request timed out') || error.message.startsWith('Network request failed'));
}

export function canRefreshAfterUnauthorized(path: string, status: number, retried: boolean): boolean {
  return status === 401 && !retried && !path.startsWith('/auth/');
}

export function nextAccessAfterBlockedRefresh(session: AuthSession, now: number): 'use' | 'sign-out' {
  const expiresAt = Date.parse(session.accessTokenExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now ? 'use' : 'sign-out';
}

export const CUSTOMER_SESSION_STORAGE_KEY = 'riders.customer.session';

export type KeyValueStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function readPersistedSession(persistent: KeyValueStore, legacy: KeyValueStore | null = null): AuthSession | null {
  const current = readStoredSession(persistent);
  if (current) {
    legacy?.removeItem(CUSTOMER_SESSION_STORAGE_KEY);
    return current;
  }
  if (!legacy) {
    return null;
  }
  const previous = readStoredSession(legacy);
  if (!previous) {
    return null;
  }
  writePersistedSession(previous, persistent);
  legacy.removeItem(CUSTOMER_SESSION_STORAGE_KEY);
  return previous;
}

export function writePersistedSession(session: AuthSession, storage: KeyValueStore): void {
  storage.setItem(CUSTOMER_SESSION_STORAGE_KEY, JSON.stringify({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    accessTokenExpiresAt: session.accessTokenExpiresAt,
    refreshTokenExpiresAt: session.refreshTokenExpiresAt,
  }));
}

export function clearPersistedSession(persistent: KeyValueStore, legacy: KeyValueStore | null = null): void {
  persistent.removeItem(CUSTOMER_SESSION_STORAGE_KEY);
  legacy?.removeItem(CUSTOMER_SESSION_STORAGE_KEY);
}

export function readStoredSession(storage: KeyValueStore): AuthSession | null {
  const raw = storage.getItem(CUSTOMER_SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return readSession(JSON.parse(raw) as unknown);
  } catch {
    storage.removeItem(CUSTOMER_SESSION_STORAGE_KEY);
    return null;
  }
}

export function sameSession(left: AuthSession | null, right: AuthSession | null): boolean {
  return left?.accessToken === right?.accessToken && left?.refreshToken === right?.refreshToken;
}

export function sessionFromStorageValue(value: string | null): AuthSession | null {
  if (!value) {
    return null;
  }
  try {
    return readSession(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

function textField(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
