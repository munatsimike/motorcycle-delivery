import type { RiderOnboarding, RiderOnboardingRepository } from './riderOnboarding';
import type { RiderSessionGate } from '../../auth/domain/sessionGate';

export function loadRiderOnboarding(
  gate: RiderSessionGate,
  repository: RiderOnboardingRepository,
): Promise<RiderOnboarding> {
  return gate.authorized((accessToken) => repository.load(accessToken));
}
