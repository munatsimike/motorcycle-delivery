import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { riderOnboardingRepository } from '../../../onboarding/data/RiderOnboardingApiRepository';
import { loadRiderOnboarding } from '../../../onboarding/domain/loadRiderOnboarding';
import { riderReadiness, type RiderOnboarding, type RiderReadiness } from '../../../onboarding/domain/riderOnboarding';
import { SessionExpiredError } from '../../domain/sessionGate';
import { errorMessage } from '../errorMessage';
import { useSession } from './useSession';

export function useRiderHome() {
  const { gate, expireSession } = useSession();
  const [onboarding, setOnboarding] = useState<RiderOnboarding | null>(null);
  const [readiness, setReadiness] = useState<RiderReadiness | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (mode: 'initial' | 'quiet' = 'initial') => {
    if (mode === 'initial') {
      setIsLoading(true);
      setError(null);
    }
    try {
      const loaded = await loadRiderOnboarding(gate, riderOnboardingRepository);
      setOnboarding(loaded);
      setReadiness(riderReadiness(loaded));
      setError(null);
    } catch (caught) {
      if (caught instanceof SessionExpiredError) {
        await expireSession();
        return;
      }
      if (mode === 'initial') {
        setOnboarding(null);
        setReadiness(null);
        setError(errorMessage(caught, 'Rider status could not be loaded.'));
      }
    } finally {
      setIsLoading(false);
    }
  }, [expireSession, gate]);

  useEffect(() => {
    void reload('initial');
  }, [reload]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void reload('quiet');
      }
    });
    return () => subscription.remove();
  }, [reload]);

  return { onboarding, readiness, isLoading, error, reload };
}
