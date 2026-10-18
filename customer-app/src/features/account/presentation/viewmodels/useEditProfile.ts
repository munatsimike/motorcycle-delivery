import { useRef, useState } from 'react';

import { errorMessage } from '../../../auth/presentation/errorMessage';
import { customerAccountRepository } from '../../data/CustomerAccountApiRepository';
import type { CustomerAccount } from '../../domain/customerAccount';
import { profileEditChange, profileEditErrors, profileFullName } from '../../domain/profileEdit';
import { updateCustomerProfile } from '../../domain/usecases/updateCustomerProfile';
import { rememberCustomerAccount } from './customerAccountCache';

export function useEditProfile(accessToken: string | null, account: CustomerAccount) {
  const [fullName, setFullName] = useState(() => profileFullName(account));
  const [address, setAddress] = useState(account.address);
  const [isSaving, setIsSaving] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const draft = { fullName, address };
  const fieldErrors = profileEditErrors(draft);
  const change = profileEditChange(draft, account);

  async function save(): Promise<boolean> {
    if (!accessToken || !change || saving.current) {
      return false;
    }
    saving.current = true;
    setIsSaving(true);
    setError(null);
    try {
      const updated = await updateCustomerProfile(customerAccountRepository, accessToken, change);
      rememberCustomerAccount(accessToken, updated);
      return true;
    } catch (caught: unknown) {
      setError(errorMessage(caught, 'The profile could not be saved.'));
      return false;
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  }

  return {
    fullName,
    setFullName,
    address,
    setAddress,
    phone: account.phone,
    fieldErrors,
    canSave: Boolean(change) && !isSaving,
    isSaving,
    error,
    save,
  };
}
