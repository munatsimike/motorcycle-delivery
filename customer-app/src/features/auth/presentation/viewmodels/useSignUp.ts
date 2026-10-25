import { useRef, useState } from 'react';

import { customerAuthRepository } from '../../data/repositories/CustomerAuthApiRepository';
import { normalizePhone } from '../../domain/normalizePhone';
import { errorMessage } from '../errorMessage';

export function useSignUp() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function startWhatsAppRegistration(input: {
    phone: string;
    fullName: string;
    address: string;
    whatsappConsent: boolean;
  }): Promise<string | null> {
    if (inFlight.current) {
      return null;
    }
    if (!input.whatsappConsent) {
      setError('Consent to WhatsApp authentication messages is required');
      return null;
    }
    inFlight.current = true;
    setIsLoading(true);
    setError(null);
    try {
      const phone = normalizePhone(input.phone);
      await customerAuthRepository.startWhatsAppRegistration({
        phone,
        accountKind: 'INDIVIDUAL',
        fullName: input.fullName.trim(),
        address: input.address.trim(),
        whatsappConsent: true,
      });
      return phone;
    } catch (caught) {
      setError(errorMessage(caught, 'Registration could not be started.'));
      return null;
    } finally {
      inFlight.current = false;
      setIsLoading(false);
    }
  }

  return { isLoading, error, startWhatsAppRegistration };
}
