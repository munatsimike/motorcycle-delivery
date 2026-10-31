import type { CustomerAccount } from '../customerAccount';
import type { ProfileEditChange } from '../profileEdit';

export interface CustomerAccountRepository {
  current(accessToken: string): Promise<CustomerAccount>;
  update(accessToken: string, change: ProfileEditChange): Promise<CustomerAccount>;
  uploadProfilePhoto(
    accessToken: string,
    file: { uri: string; name: string; type: string },
    onProgress: (percent: number) => void,
  ): Promise<void>;
  deleteProfilePhoto(accessToken: string): Promise<void>;
}
