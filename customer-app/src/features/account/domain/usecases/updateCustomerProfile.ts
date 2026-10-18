import type { CustomerAccount } from '../customerAccount';
import type { ProfileEditChange } from '../profileEdit';
import type { CustomerAccountRepository } from '../repositories/CustomerAccountRepository';

export function updateCustomerProfile(
  repository: CustomerAccountRepository,
  accessToken: string,
  change: ProfileEditChange,
): Promise<CustomerAccount> {
  return repository.update(accessToken, change);
}
