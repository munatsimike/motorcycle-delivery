import { apiPost } from '../../../services/api/apiClient';
import { readAuthSession, readPendingOtp } from '../domain/parseAuth';
import type { AuthSession, PendingOtp } from '../domain/auth.types';
import type { RiderAuthRepository } from '../domain/repositories/RiderAuthRepository';

export class RiderAuthApiRepository implements RiderAuthRepository {
  requestRegistrationCode(phone: string, fullName: string): Promise<PendingOtp> {
    return apiPost<unknown>('/auth/rider/register/otp', { phone, fullName }).then(readPendingOtp);
  }

  verifyRegistrationCode(phone: string, code: string): Promise<AuthSession> {
    return apiPost<unknown>('/auth/rider/register/verify', { phone, code }).then(readAuthSession);
  }

  requestLoginCode(phone: string): Promise<PendingOtp> {
    return apiPost<unknown>('/auth/rider/login/otp', { phone }).then(readPendingOtp);
  }

  verifyLoginCode(phone: string, code: string): Promise<AuthSession> {
    return apiPost<unknown>('/auth/rider/login/verify', { phone, code }).then(readAuthSession);
  }

  refresh(refreshToken: string): Promise<AuthSession> {
    return apiPost<unknown>('/auth/session/refresh', { refreshToken }).then(readAuthSession);
  }

  async logout(accessToken: string): Promise<void> {
    await apiPost<unknown>('/auth/session/logout', {}, { accessToken });
  }

  async logoutAll(accessToken: string): Promise<void> {
    await apiPost<unknown>('/auth/session/logout-all', {}, { accessToken });
  }
}

export const riderAuthRepository = new RiderAuthApiRepository();
