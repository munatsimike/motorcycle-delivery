import type {
  AuthSession,
  CompleteRegistrationRequest,
  PendingOtp,
  RegistrationProof,
} from '../auth.types';

export interface CustomerAuthRepository {
  requestRegistrationCode(phone: string): Promise<PendingOtp>;
  requestLoginCode(phone: string): Promise<PendingOtp>;
  verifyRegistrationCode(phone: string, code: string): Promise<RegistrationProof>;
  verifyLoginCode(phone: string, code: string): Promise<AuthSession>;
  completeRegistration(request: CompleteRegistrationRequest): Promise<AuthSession>;
  refresh(refreshToken: string): Promise<AuthSession>;
  logout(accessToken: string): Promise<void>;
}
