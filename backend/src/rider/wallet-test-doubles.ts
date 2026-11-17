export type WalletLookup = {
  id?: string;
  riderProfileId?: string;
  riderProfileId_currency?: { riderProfileId: string; currency: string };
};

export function walletLookup(where: WalletLookup): { id?: string; riderProfileId?: string; currency?: string } {
  if (where.riderProfileId_currency) {
    return {
      riderProfileId: where.riderProfileId_currency.riderProfileId,
      currency: where.riderProfileId_currency.currency,
    };
  }
  return { id: where.id, riderProfileId: where.riderProfileId };
}

export function sameWallet(
  wallet: { id?: string; riderProfileId?: string; currency?: string },
  lookup: { id?: string; riderProfileId?: string; currency?: string },
): boolean {
  if (lookup.id) {
    return wallet.id === lookup.id;
  }
  if (!lookup.riderProfileId || wallet.riderProfileId !== lookup.riderProfileId) return false;
  if (lookup.currency && wallet.currency && wallet.currency !== lookup.currency) return false;
  return true;
}
