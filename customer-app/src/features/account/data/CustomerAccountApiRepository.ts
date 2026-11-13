import { apiDelete, apiGet, apiPatch, apiUpload } from '../../../services/api/apiClient';
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

  async uploadProfilePhoto(
    accessToken: string,
    file: { uri: string; name: string; type: string },
    onProgress: (percent: number) => void,
  ): Promise<void> {
    await apiUpload('/customers/me/profile-photo', file, { accessToken, onProgress });
  }

  async deleteProfilePhoto(accessToken: string): Promise<void> {
    await apiDelete('/customers/me/profile-photo', undefined, { accessToken });
  }
}

export const customerAccountRepository = new CustomerAccountApiRepository();
