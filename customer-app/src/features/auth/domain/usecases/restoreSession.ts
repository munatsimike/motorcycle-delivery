import { loadCustomerIdentity, saveCustomerIdentity } from '../../../deliveries/data/recentDeliveryStore';
import { rebindCustomerIdentity } from '../../../../services/session/customerIdentity';
import type { AuthSession } from '../auth.types';
import type { CustomerAuthRepository } from '../repositories/CustomerAuthRepository';
import type { CustomerSessionStore } from '../repositories/CustomerSessionStore';

const REFRESH_WINDOW_MS = 30_000;

export async function restoreSession(
  repository: CustomerAuthRepository,
  store: CustomerSessionStore,
  now = Date.now(),
): Promise<AuthSession | null> {
  const stored = await store.load();
  if (!stored) {
    return null;
  }

  const accessExpiresAt = Date.parse(stored.accessTokenExpiresAt);
  if (Number.isFinite(accessExpiresAt) && accessExpiresAt - now > REFRESH_WINDOW_MS) {
    return stored;
  }

  try {
    const refreshed = await repository.refresh(stored.refreshToken);
    const identity = await loadCustomerIdentity();
    const rebound = rebindCustomerIdentity(identity, stored.refreshToken, refreshed.refreshToken);
    if (rebound) {
      await saveCustomerIdentity(rebound);
    }
    await store.save(refreshed);
    return refreshed;
  } catch {
    await store.clear();
    return null;
  }
}
