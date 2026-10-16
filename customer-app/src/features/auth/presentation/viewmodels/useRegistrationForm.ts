import { useRef, useState } from 'react';

import { customerAuthRepository } from '../../data/repositories/CustomerAuthApiRepository';
import type { AccountKind, AuthSession } from '../../domain/auth.types';
import { completeRegistration } from '../../domain/usecases/completeRegistration';
import { errorMessage } from '../errorMessage';

export function useRegistrationForm(registrationToken: string) {
  const [accountKind, setAccountKind] = useState<AccountKind>('INDIVIDUAL');
  const [fullName, setFullName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [contactName, setContactName] = useState('');
  const [address, setAddress] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function submit(): Promise<AuthSession | null> {
    if (inFlight.current) {
      return null;
    }
    inFlight.current = true;
    setIsLoading(true);
    setError(null);
    try {
      const profile = accountKind === 'INDIVIDUAL'
        ? { accountKind, fullName, address }
        : { accountKind, businessName, contactName, address };
      return await completeRegistration(customerAuthRepository, {
        registrationToken,
        ...profile,
      });
    } catch (caught) {
      setError(errorMessage(caught, 'Registration failed. Please try again.'));
      return null;
    } finally {
      inFlight.current = false;
      setIsLoading(false);
    }
  }

  return {
    accountKind,
    setAccountKind,
    fullName,
    setFullName,
    businessName,
    setBusinessName,
    contactName,
    setContactName,
    address,
    setAddress,
    isLoading,
    error,
    submit,
  };
}
