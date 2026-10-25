import type { CustomerAuthRepository } from '../repositories/CustomerAuthRepository';
import type { CustomerSessionStore } from '../repositories/CustomerSessionStore';

export async function logoutCustomer(
  repository: CustomerAuthRepository,
  store: CustomerSessionStore,
  accessToken: string | null,
): Promise<void> {
  try {
    if (accessToken) {
      await repository.logout(accessToken);
    }
  } finally {
    await store.clear();
  }
}
