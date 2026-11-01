import { useRef, useState } from 'react';

import { customerAuthRepository } from '../../data/repositories/CustomerAuthApiRepository';
import type { SignInCodeRequest } from '../../domain/customerAuthJourney';
import { requestSignInCode } from '../../domain/customerAuthJourney';
import { errorMessage } from '../errorMessage';

export function useSignIn() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function startWhatsAppLogin(phone: string): Promise<SignInCodeRequest | null> {
    if (inFlight.current) {
      return null;
    }
    inFlight.current = true;
    setIsLoading(true);
    setError(null);
    try {
      const started = await requestSignInCode(customerAuthRepository, phone);
      if (started.status === 'unavailable') {
        setError('Account not found. Create an account to continue.');
        return started;
      }
      return started;
    } catch (caught) {
      setError(errorMessage(caught, 'WhatsApp verification is unavailable'));
      return null;
    } finally {
      inFlight.current = false;
      setIsLoading(false);
    }
  }

  return { isLoading, error, startWhatsAppLogin };
}
