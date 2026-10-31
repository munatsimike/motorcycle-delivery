import { loadCustomerIdentity, saveCustomerIdentity } from '../../../deliveries/data/recentDeliveryStore';
import { rebindCustomerIdentity } from '../../../../services/session/customerIdentity';
import { REFRESH_WINDOW_MS } from '../../../../services/session/sessionAccess';
import type { AuthSession } from '../auth.types';
import type { CustomerAuthRepository } from '../repositories/CustomerAuthRepository';
import type { CustomerSessionStore } from '../repositories/CustomerSessionStore';

export type SessionRestore =
  | { status: 'ready'; session: AuthSession }
  | { status: 'offline' }
  | { status: 'signed-out' };

export async function restoreSession(
  repository: CustomerAuthRepository,
  store: CustomerSessionStore,
  now = Date.now(),
  preloaded: AuthSession | null = null,
  options: { requireLiveSession?: boolean } = {},
): Promise<SessionRestore> {
  const stored = preloaded ?? await store.load();
  if (!stored) {
    return { status: 'signed-out' };
  }

  const refreshExpiresAt = Date.parse(stored.refreshTokenExpiresAt);
  if (Number.isFinite(refreshExpiresAt) && refreshExpiresAt <= now) {
    await store.clear();
    return { status: 'signed-out' };
  }

  const accessExpiresAt = Date.parse(stored.accessTokenExpiresAt);
  const accessStillValid = Number.isFinite(accessExpiresAt) && accessExpiresAt - now > REFRESH_WINDOW_MS;
  if (accessStillValid && !options.requireLiveSession) {
    return { status: 'ready', session: stored };
  }

  try {
    const refreshed = await repository.refresh(stored.refreshToken);
    await rebindSavedIdentity(stored.refreshToken, refreshed.refreshToken);
    try {
      await store.save(refreshed);
    } catch {
      // The rotated session stays in memory when the phone cannot rewrite secure storage yet.
    }
    return { status: 'ready', session: refreshed };
  } catch (error: unknown) {
    if (isRevokedSession(error) || !Number.isFinite(accessExpiresAt) || accessExpiresAt <= now) {
      if (isRevokedSession(error)) {
        await store.clear();
        return { status: 'signed-out' };
      }
      return { status: 'offline' };
    }
    return { status: 'ready', session: stored };
  }
}

function isRevokedSession(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return false;
  }
  const status = error.status;
  return status === 401 || status === 403;
}

async function rebindSavedIdentity(previousRefreshToken: string, nextRefreshToken: string) {
  try {
    const identity = await loadCustomerIdentity();
    const rebound = rebindCustomerIdentity(identity, previousRefreshToken, nextRefreshToken);
    if (rebound) {
      await saveCustomerIdentity(rebound);
    }
  } catch {
    // A saved delivery cache can be rebuilt after the new session is stored.
  }
}
