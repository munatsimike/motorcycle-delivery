import { useRef, useState } from 'react';

import { customerAuthRepository } from '../../data/repositories/CustomerAuthApiRepository';
import type { LoginStart } from '../../domain/auth.types';
import { normalizePhone } from '../../domain/normalizePhone';
import { errorMessage } from '../errorMessage';

export function useSignIn() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function startWhatsAppLogin(phone: string): Promise<LoginStart & { phone?: string } | null> {
    if (inFlight.current) {
      return null;
    }
    inFlight.current = true;
    setIsLoading(true);
    setError(null);
    try {
      const normalized = normalizePhone(phone);
      const started = await customerAuthRepository.startWhatsAppLogin(normalized);
      if (started.status === 'unavailable') {
        setError('Account not found. Create an account to continue.');
        return { status: 'unavailable' };
      }
      return { status: 'pending', phone: normalized };
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
