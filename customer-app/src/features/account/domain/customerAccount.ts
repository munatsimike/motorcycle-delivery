export type CustomerAccount = {
  id: string | null;
  kind: 'INDIVIDUAL' | 'BUSINESS';
  name: string;
  contactName: string | null;
  address: string;
  phone: string;
  email: string | null;
  photoUrl: string | null;
  marketplaceEnabled: boolean;
};

export type MarketplaceSignal = boolean | null;

export function bookingMode(signal: MarketplaceSignal): 'v1' | 'v2' | 'unknown' {
  if (signal === true) {
    return 'v2';
  }
  if (signal === false) {
    return 'v1';
  }
  return 'unknown';
}

export function nextMarketplaceSignal(
  known: MarketplaceSignal,
  outcome: { type: 'loaded'; enabled: boolean } | { type: 'network' } | { type: 'authentication' },
): MarketplaceSignal {
  if (outcome.type === 'loaded') {
    return outcome.enabled;
  }
  return known;
}

export function readCustomerAccount(value: unknown): CustomerAccount {
  if (!isRecord(value)) {
    throw new Error('Account details are unavailable.');
  }
  const kind = value.kind === 'BUSINESS' ? 'BUSINESS' : value.kind === 'INDIVIDUAL' ? 'INDIVIDUAL' : null;
  const name = text(value.name);
  const address = text(value.address);
  const phone = text(value.phone);
  const email = readEmail(value.email);
  const contactName = value.contactName === null ? null : text(value.contactName);
  if (!kind || !name || !address || !phone || contactName === undefined) {
    throw new Error('Account details are unavailable.');
  }
  if (typeof value.marketplaceEnabled !== 'boolean') {
    throw new Error('Account details are unavailable.');
  }
  return {
    id: text(value.id),
    kind,
    name,
    contactName,
    address,
    phone,
    email,
    photoUrl: optionalPhoto(value.photoUrl),
    marketplaceEnabled: value.marketplaceEnabled,
  };
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readEmail(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const email = text(value);
  if (!email) {
    throw new Error('Account details are unavailable.');
  }
  return email;
}

function optionalPhoto(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const photo = value.trim();
  return photo.length > 0 ? photo : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
