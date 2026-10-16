import type { CustomerAccount } from '../customerAccount';

export interface CustomerAccountRepository {
  current(accessToken: string): Promise<CustomerAccount>;
}
