import { apiGet } from '../../../services/api/apiClient';
import { readCustomerAccount, type CustomerAccount } from '../domain/customerAccount';
import type { CustomerAccountRepository } from '../domain/repositories/CustomerAccountRepository';

export class CustomerAccountApiRepository implements CustomerAccountRepository {
  async current(accessToken: string): Promise<CustomerAccount> {
    const body = await apiGet<unknown>('/customers/me', { accessToken });
    return readCustomerAccount(body);
  }
}

export const customerAccountRepository = new CustomerAccountApiRepository();
