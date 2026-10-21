import type {
  AuthSession,
  CompleteRegistrationRequest,
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
  refresh(refreshToken: string): Promise<AuthSession>;
  logout(accessToken: string): Promise<void>;
}
