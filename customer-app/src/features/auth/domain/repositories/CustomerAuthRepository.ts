import type { AuthSession, CompleteRegistrationRequest, LoginStart, PendingOtp, RegistrationVerification } from '../auth.types';

export type PhoneRegistrationRequest = {
  phone: string;
  whatsappConsent: true;
};

export interface CustomerAuthRepository {
  startWhatsAppLogin(phone: string): Promise<LoginStart>;
  resendWhatsAppLogin(phone: string): Promise<LoginStart>;
  verifyWhatsAppLogin(phone: string, code: string): Promise<RegistrationVerification>;
  startWhatsAppRegistration(request: PhoneRegistrationRequest): Promise<PendingOtp>;
  resendWhatsAppRegistration(phone: string): Promise<PendingOtp>;
  verifyWhatsAppRegistration(phone: string, code: string): Promise<RegistrationVerification>;
  completeWhatsAppRegistration(request: CompleteRegistrationRequest): Promise<AuthSession>;
  refresh(refreshToken: string): Promise<AuthSession>;
  logout(accessToken: string): Promise<void>;
}
