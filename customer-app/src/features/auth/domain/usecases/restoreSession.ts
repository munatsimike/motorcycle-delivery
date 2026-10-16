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
    await store.save(refreshed);
    return refreshed;
  } catch {
    await store.clear();
    return null;
  }
}
