import type {
  AuthSession,
  CompleteRegistrationRequest,
  CustomerProfile,
  PendingOtp,
  LoginStart,
  RegistrationVerification,
} from '../auth.types';

export interface CustomerAuthRepository {
  requestRegistrationCode(phone: string): Promise<PendingOtp>;
  requestLoginCode(phone: string): Promise<LoginStart>;
  verifyRegistrationCode(phone: string, code: string): Promise<RegistrationVerification>;
  verifyLoginCode(phone: string, code: string): Promise<AuthSession>;
  completeRegistration(request: CompleteRegistrationRequest): Promise<AuthSession>;
  loginWithPassword(phone: string, password: string): Promise<AuthSession>;
  setPassword(accessToken: string, password: string, refreshToken: string, currentPassword?: string): Promise<void>;
  registerWithPassword(request: CustomerProfile & { phone: string; password: string }): Promise<AuthSession>;
  startWhatsAppRegistration(request: CustomerProfile & { phone: string; password: string; whatsappConsent: true }): Promise<PendingOtp>;
  resendWhatsAppRegistration(phone: string): Promise<PendingOtp>;
  verifyWhatsAppRegistration(phone: string, code: string): Promise<AuthSession>;
  requestPasswordReset(phone: string): Promise<PendingOtp>;
  resetPassword(phone: string, code: string, password: string): Promise<void>;
  refresh(refreshToken: string): Promise<AuthSession>;
  logout(accessToken: string): Promise<void>;
}
