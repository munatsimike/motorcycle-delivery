export const CUSTOMER_IDENTITY_VERSION = 1;

export type CustomerIdentity = {
  customerId: string;
  sessionKey: string;
};

export type CustomerIdentityUpdate = {
  identity: CustomerIdentity;
  replacedCustomerId: string | null;
};

export function sessionKeyForRefreshToken(refreshToken: string): string {
  let hash = 2166136261;
  for (let index = 0; index < refreshToken.length; index += 1) {
    hash ^= refreshToken.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function confirmCustomerIdentity(
  current: CustomerIdentity | null,
  customerId: string,
  refreshToken: string,
): CustomerIdentityUpdate | null {
  const id = customerId.trim();
  const token = refreshToken.trim();
  if (!id || !token || id === token) {
    return null;
  }
  return {
    identity: {
      customerId: id,
      sessionKey: sessionKeyForRefreshToken(token),
    },
    replacedCustomerId: current && current.customerId !== id ? current.customerId : null,
  };
}

export function rebindCustomerIdentity(
  current: CustomerIdentity | null,
  previousRefreshToken: string,
  nextRefreshToken: string,
): CustomerIdentity | null {
  if (!current) {
    return null;
  }
  if (current.sessionKey !== sessionKeyForRefreshToken(previousRefreshToken)) {
    return null;
  }
  const next = nextRefreshToken.trim();
  if (!next) {
    return null;
  }
  return {
    customerId: current.customerId,
    sessionKey: sessionKeyForRefreshToken(next),
  };
}

export function customerIdForSession(current: CustomerIdentity | null, refreshToken: string): string | null {
  if (!current || current.sessionKey !== sessionKeyForRefreshToken(refreshToken)) {
    return null;
  }
  return current.customerId;
}

export function readCustomerIdentity(value: unknown): CustomerIdentity | null {
  if (!isRecord(value) || value.schemaVersion !== CUSTOMER_IDENTITY_VERSION) {
    return null;
  }
  const customerId = typeof value.customerId === 'string' ? value.customerId.trim() : '';
  const sessionKey = typeof value.sessionKey === 'string' ? value.sessionKey.trim() : '';
  if (!customerId || !sessionKey.startsWith('fnv1a-')) {
    return null;
  }
  return { customerId, sessionKey };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
