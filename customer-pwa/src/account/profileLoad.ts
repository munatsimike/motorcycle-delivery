import type { CustomerAccount } from '../auth/contracts.ts';

export type StoredProfile = {
  account: CustomerAccount;
  photoUrl: string | null;
  photoSettled: boolean;
};

let stored: StoredProfile | null = null;

function release(url: string | null) {
  if (!url) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    // The address was not created in this document.
  }
}

export function readStoredProfile(): StoredProfile | null {
  return stored;
}

// Keeps the last account for this signed-in visit. A photo is downloaded again
// only when this account has no settled picture yet.
export function storeProfileAccount(account: CustomerAccount): { photoUrl: string | null; fetchPhoto: boolean } {
  const same = stored !== null && stored.account.id === account.id;
  if (!account.hasProfilePhoto) {
    if (stored?.photoUrl) release(stored.photoUrl);
    stored = { account, photoUrl: null, photoSettled: true };
    return { photoUrl: null, fetchPhoto: false };
  }
  if (same && stored?.photoUrl) {
    stored = { account, photoUrl: stored.photoUrl, photoSettled: true };
    return { photoUrl: stored.photoUrl, fetchPhoto: false };
  }
  if (same && stored?.photoSettled && stored.account.hasProfilePhoto) {
    stored = { account, photoUrl: null, photoSettled: true };
    return { photoUrl: null, fetchPhoto: false };
  }
  if (stored?.photoUrl) release(stored.photoUrl);
  stored = { account, photoUrl: null, photoSettled: false };
  return { photoUrl: null, fetchPhoto: true };
}

export function storeProfilePhoto(accountId: string | null, photoUrl: string | null): void {
  if (!stored || stored.account.id !== accountId) {
    release(photoUrl);
    return;
  }
  if (stored.photoUrl && stored.photoUrl !== photoUrl) release(stored.photoUrl);
  stored = {
    account: { ...stored.account, hasProfilePhoto: photoUrl != null || stored.account.hasProfilePhoto },
    photoUrl,
    photoSettled: true,
  };
}

export function clearStoredProfilePhoto(accountId: string | null): void {
  if (!stored || stored.account.id !== accountId) return;
  release(stored.photoUrl);
  stored = {
    account: { ...stored.account, hasProfilePhoto: false },
    photoUrl: null,
    photoSettled: true,
  };
}

export function clearStoredProfile(): void {
  release(stored?.photoUrl ?? null);
  stored = null;
}
