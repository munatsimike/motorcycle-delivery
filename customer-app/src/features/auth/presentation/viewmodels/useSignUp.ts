import { useRef, useState } from 'react';

import { customerAuthRepository } from '../../data/repositories/CustomerAuthApiRepository';
import { requestRegistrationCode } from '../../domain/usecases/requestRegistrationCode';
import { errorMessage } from '../errorMessage';

export function useSignUp() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function requestCode(phone: string): Promise<string | null> {
    if (inFlight.current) {
      return null;
    }
    inFlight.current = true;
    setIsLoading(true);
    setError(null);
    try {
      return await requestRegistrationCode(customerAuthRepository, phone);
    } catch (caught) {
      setError(errorMessage(caught, 'Registration could not be started.'));
      return null;
    } finally {
      inFlight.current = false;
      setIsLoading(false);
    }
  }

  return { isLoading, error, requestCode };
}
