import type { CustomerAuthRepository } from '../repositories/CustomerAuthRepository';
import type { CustomerSessionStore } from '../repositories/CustomerSessionStore';

export async function logoutCustomer(
  repository: CustomerAuthRepository,
  store: CustomerSessionStore & {
    saveBiometricEnabled(enabled: boolean): Promise<void>;
  },
  accessToken: string | null,
  scope: 'device' | 'all' = 'device',
): Promise<void> {
  try {
    if (accessToken) {
      if (scope === 'all') {
        await repository.logoutAll(accessToken);
      } else {
        await repository.logout(accessToken);
      }
    }
  } finally {
    try {
      await store.saveBiometricEnabled(false);
    } finally {
      await store.clear();
    }
  }
}
