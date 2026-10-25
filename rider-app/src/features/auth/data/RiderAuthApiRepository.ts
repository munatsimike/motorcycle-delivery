import { apiPost } from '../../../services/api/apiClient';
import { readAuthSession, readLoginStart, readPendingOtp } from '../domain/parseAuth';
import type { AuthSession, PendingOtp } from '../domain/auth.types';
import type { RiderAuthRepository } from '../domain/repositories/RiderAuthRepository';

export class RiderAuthApiRepository implements RiderAuthRepository {
  requestRegistrationCode(phone: string, fullName: string, address: string): Promise<PendingOtp> {
    return apiPost<unknown>('/auth/rider/register/whatsapp', {
      phone,
      fullName,
      address,
      whatsappConsent: true,
    }).then(readPendingOtp);
  }

  resendRegistrationCode(phone: string): Promise<PendingOtp> {
    return apiPost<unknown>('/auth/rider/register/whatsapp/resend', { phone }).then(readPendingOtp);
  }

  verifyRegistrationCode(phone: string, code: string): Promise<AuthSession> {
    return apiPost<unknown>('/auth/rider/register/whatsapp/verify', { phone, code }).then(readAuthSession);
  }

  requestLoginCode(phone: string): Promise<PendingOtp> {
    return apiPost<unknown>('/auth/rider/login/whatsapp', { phone, whatsappConsent: true }).then(readLoginStart);
  }

  resendLoginCode(phone: string): Promise<PendingOtp> {
    return apiPost<unknown>('/auth/rider/login/whatsapp/resend', { phone }).then(readLoginStart);
  }

  verifyLoginCode(phone: string, code: string): Promise<AuthSession> {
    return apiPost<unknown>('/auth/rider/login/whatsapp/verify', { phone, code }).then(readAuthSession);
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
