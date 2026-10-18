import { apiGet, apiPatch } from '../../../services/api/apiClient';
import { readCustomerAccount, type CustomerAccount } from '../domain/customerAccount';
import type { ProfileEditChange } from '../domain/profileEdit';
import type { CustomerAccountRepository } from '../domain/repositories/CustomerAccountRepository';

export class CustomerAccountApiRepository implements CustomerAccountRepository {
  async current(accessToken: string): Promise<CustomerAccount> {
    const body = await apiGet<unknown>('/customers/me', { accessToken });
    return readCustomerAccount(body);
  }

  async update(accessToken: string, change: ProfileEditChange): Promise<CustomerAccount> {
    const body = await apiPatch<unknown>('/customers/me', {
      fullName: change.fullName,
      email: change.email,
      address: change.address,
    }, { accessToken });
    return readCustomerAccount(body);
  }
}

export const customerAccountRepository = new CustomerAccountApiRepository();
