import { useRef, useState } from 'react';

import { customerAuthRepository } from '../../data/repositories/CustomerAuthApiRepository';
import type { AuthSession } from '../../domain/auth.types';
import { loginWithPassword as signInWithPassword } from '../../domain/usecases/loginWithPassword';
import { requestLoginCode, type LoginCodeResult } from '../../domain/usecases/requestLoginCode';
import { errorMessage } from '../errorMessage';

export function useSignIn() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function requestCode(phone: string): Promise<LoginCodeResult | null> {
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

  async function loginWithPassword(phone: string, password: string): Promise<AuthSession | null> {
    if (inFlight.current) {
      return null;
    }
    if (password.length < 12 || password.length > 128) {
      setError('Password must contain 12 to 128 characters');
      return null;
    }
    inFlight.current = true;
    setIsLoading(true);
    setError(null);
    try {
      return await signInWithPassword(customerAuthRepository, phone, password);
    } catch (caught) {
      setError(errorMessage(caught, 'Authentication failed'));
      return null;
    } finally {
      inFlight.current = false;
      setIsLoading(false);
    }
  }

  return { isLoading, error, requestCode, loginWithPassword };
}
