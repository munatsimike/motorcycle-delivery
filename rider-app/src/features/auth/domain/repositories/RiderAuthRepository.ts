import type { AuthSession, PendingOtp } from '../auth.types';

export type RiderAuthRepository = {
  requestRegistrationCode(phone: string, fullName: string, address: string): Promise<PendingOtp>;
  resendRegistrationCode(phone: string): Promise<PendingOtp>;
  verifyRegistrationCode(phone: string, code: string): Promise<AuthSession>;
  requestLoginCode(phone: string): Promise<PendingOtp>;
  resendLoginCode(phone: string): Promise<PendingOtp>;
  verifyLoginCode(phone: string, code: string): Promise<AuthSession>;
  refresh(refreshToken: string): Promise<AuthSession>;
  logout(accessToken: string): Promise<void>;
  logoutAll(accessToken: string): Promise<void>;
};
