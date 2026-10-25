import type { AuthSession, CustomerProfile, LoginStart, PendingOtp } from '../auth.types';

export interface CustomerAuthRepository {
  startWhatsAppLogin(phone: string): Promise<LoginStart>;
  resendWhatsAppLogin(phone: string): Promise<LoginStart>;
  verifyWhatsAppLogin(phone: string, code: string): Promise<AuthSession>;
  startWhatsAppRegistration(request: CustomerProfile & { phone: string; whatsappConsent: true }): Promise<PendingOtp>;
  resendWhatsAppRegistration(phone: string): Promise<PendingOtp>;
  verifyWhatsAppRegistration(phone: string, code: string): Promise<AuthSession>;
  refresh(refreshToken: string): Promise<AuthSession>;
  logout(accessToken: string): Promise<void>;
}
