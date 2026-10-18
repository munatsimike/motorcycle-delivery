import type { CustomerAccount } from './customerAccount';

export type ProfileEditDraft = {
  fullName: string;
  address: string;
};

export type ProfileEditChange = {
  fullName: string;
  email: string | null;
  address: string;
};

export function profileFullName(account: Pick<CustomerAccount, 'kind' | 'name' | 'contactName'>): string {
  return account.kind === 'BUSINESS' ? account.contactName ?? '' : account.name;
}

export function profileEditErrors(draft: ProfileEditDraft): { fullName: string | null; address: string | null } {
  return {
    fullName: fullNameError(draft.fullName),
    address: addressError(draft.address),
  };
}

export function profileEditChange(draft: ProfileEditDraft, account: CustomerAccount): ProfileEditChange | null {
  const errors = profileEditErrors(draft);
  if (errors.fullName || errors.address) {
    return null;
  }
  const fullName = normalizeName(draft.fullName);
  const address = normalizeAddress(draft.address);
  if (!fullName || !address) {
    return null;
  }
  if (fullName === profileFullName(account) && address === account.address) {
    return null;
  }
  return { fullName, email: account.email, address };
}

function fullNameError(value: string): string | null {
  const name = normalizeName(value);
  if (!name) {
    return 'Full name is required.';
  }
  if (name.length > 200 || /[\u0000-\u001f]/.test(name)) {
    return 'Enter a valid full name.';
  }
  return null;
}

function addressError(value: string): string | null {
  const address = normalizeAddress(value);
  if (!address || address.length > 500 || /[\u0000-\u001f]/.test(address)) {
    return 'Address is required.';
  }
  return null;
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeAddress(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}
