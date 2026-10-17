import { apiGet } from '../../../services/api/apiClient';
import { readRiderOnboarding, type RiderOnboarding } from '../domain/riderOnboarding';
import type { RiderOnboardingRepository } from '../domain/riderOnboarding';

export class RiderOnboardingApiRepository implements RiderOnboardingRepository {
  load(accessToken: string): Promise<RiderOnboarding> {
    return apiGet<unknown>('/riders/me/onboarding', { accessToken }).then(readRiderOnboarding);
  }
}

export const riderOnboardingRepository = new RiderOnboardingApiRepository();
