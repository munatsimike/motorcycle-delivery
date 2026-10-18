import type { CustomerAccount } from '../../domain/customerAccount';

type Listener = (account: CustomerAccount) => void;

let revision = 0;
let cached: { accessToken: string; account: CustomerAccount } | null = null;
const listeners = new Set<Listener>();

export function customerAccountRevision(): number {
  return revision;
}

export function cachedCustomerAccount(accessToken: string): CustomerAccount | null {
  return cached?.accessToken === accessToken ? cached.account : null;
}

export function rememberCustomerAccount(accessToken: string, account: CustomerAccount): void {
  revision += 1;
  cached = { accessToken, account };
  for (const listener of listeners) {
    listener(account);
  }
}

export function subscribeCustomerAccount(accessToken: string, listener: Listener): () => void {
  const wrapped: Listener = (account) => {
    if (cached?.accessToken === accessToken) {
      listener(account);
    }
  };
  listeners.add(wrapped);
  return () => {
    listeners.delete(wrapped);
  };
}
