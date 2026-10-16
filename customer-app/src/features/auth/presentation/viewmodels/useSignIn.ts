import { useRef, useState } from 'react';

import { customerAuthRepository } from '../../data/repositories/CustomerAuthApiRepository';
import { requestLoginCode } from '../../domain/usecases/requestLoginCode';
import { errorMessage } from '../errorMessage';

export function useSignIn() {
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
      return await requestLoginCode(customerAuthRepository, phone);
    } catch (caught) {
      setError(errorMessage(caught, 'Sign in could not be started.'));
      return null;
    } finally {
      inFlight.current = false;
      setIsLoading(false);
    }
  }

  return { isLoading, error, requestCode };
}
