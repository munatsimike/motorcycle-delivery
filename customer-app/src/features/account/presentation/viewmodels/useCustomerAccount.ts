import { useEffect, useState } from 'react';

import { errorMessage } from '../../../auth/presentation/errorMessage';
import { customerAccountRepository } from '../../data/CustomerAccountApiRepository';
import type { CustomerAccount } from '../../domain/customerAccount';
import { loadCustomerAccount } from '../../domain/usecases/loadCustomerAccount';
import {
  cachedCustomerAccount,
  customerAccountRevision,
  rememberCustomerAccount,
  subscribeCustomerAccount,
} from './customerAccountCache';

export function useCustomerAccount(accessToken: string | null) {
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) {
      return;
    }
    return subscribeCustomerAccount(accessToken, setAccount);
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) {
      setAccount(null);
      setError('Account details are unavailable.');
      setIsLoading(false);
      return;
    }

    const saved = cachedCustomerAccount(accessToken);
    if (saved) {
      setAccount(saved);
      setError(null);
      setIsLoading(false);
      return;
    }

    let active = true;
    const started = customerAccountRevision();
    setIsLoading(true);
    setError(null);
    loadCustomerAccount(customerAccountRepository, accessToken)
      .then((loaded) => {
        if (!active || started !== customerAccountRevision()) {
          return;
        }
        rememberCustomerAccount(accessToken, loaded);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (active && started === customerAccountRevision()) {
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
