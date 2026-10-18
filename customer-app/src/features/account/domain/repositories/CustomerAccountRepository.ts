import type { CustomerAccount } from '../customerAccount';
import type { ProfileEditChange } from '../profileEdit';

export interface CustomerAccountRepository {
  current(accessToken: string): Promise<CustomerAccount>;
  update(accessToken: string, change: ProfileEditChange): Promise<CustomerAccount>;
}
