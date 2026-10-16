import type { CustomerAccount } from '../customerAccount';
import type { CustomerAccountRepository } from '../repositories/CustomerAccountRepository';

export function loadCustomerAccount(
  repository: CustomerAccountRepository,
  accessToken: string,
): Promise<CustomerAccount> {
  return repository.current(accessToken);
}
