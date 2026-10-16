import { useEffect, useState } from 'react';

import { errorMessage } from '../../../auth/presentation/errorMessage';
import { customerAccountRepository } from '../../data/CustomerAccountApiRepository';
import type { CustomerAccount } from '../../domain/customerAccount';
import { loadCustomerAccount } from '../../domain/usecases/loadCustomerAccount';

export function useCustomerAccount(accessToken: string | null) {
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) {
      setAccount(null);
      setError('Account details are unavailable.');
      setIsLoading(false);
      return;
    }

    let active = true;
    setIsLoading(true);
    setError(null);
    loadCustomerAccount(customerAccountRepository, accessToken)
      .then((loaded) => {
        if (active) {
          setAccount(loaded);
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setAccount(null);
          setError(errorMessage(caught, 'Account details are unavailable.'));
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [accessToken]);

  return { account, isLoading, error };
}
