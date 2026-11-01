import { useRef, useState } from 'react';

import { ApiError } from '../../../../services/api/apiClient';
import { customerAuthRepository } from '../../data/repositories/CustomerAuthApiRepository';
import type { AuthSession } from '../../domain/auth.types';
import { submitCustomerRegistration } from '../../domain/customerAuthJourney';
import { createSingleFlight } from '../../domain/registrationRecovery';
import { errorMessage } from '../errorMessage';

export type RegistrationCompletion =
  | { status: 'created'; session: AuthSession }
  | { status: 'rejected' }
  | { status: 'interrupted'; message: string }
  | { status: 'busy' };

export function useCompleteRegistration(registrationToken: string) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flight = useRef(createSingleFlight());

  async function complete(fullName: string, address: string): Promise<RegistrationCompletion> {
    if (!flight.current.enter()) {
      return { status: 'busy' };
    }
    const name = fullName.trim();
    const place = address.trim();
    if (!name || !place) {
      flight.current.leave();
      setError('Enter your name and address.');
      return { status: 'interrupted', message: 'Enter your name and address.' };
    }
    setIsLoading(true);
    setError(null);
    try {
      const session = await submitCustomerRegistration(customerAuthRepository, {
        registrationToken,
        accountKind: 'INDIVIDUAL',
        fullName: name,
        address: place,
      });
      return { status: 'created', session };
    } catch (caught) {
      if (caught instanceof ApiError && (caught.status === 401 || caught.status === 403)) {
        return { status: 'rejected' };
      }
      const message = errorMessage(caught, 'Registration could not be finished.');
      setError(message);
      return { status: 'interrupted', message };
    } finally {
      flight.current.leave();
      setIsLoading(false);
    }
  }

  return { isLoading, error, complete };
}
