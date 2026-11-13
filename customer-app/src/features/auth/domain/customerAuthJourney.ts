import type { CustomerAuthRepository } from './repositories/CustomerAuthRepository';
import type { CustomerSessionStore } from './repositories/CustomerSessionStore';
import type {
  AuthFlow,
  AuthSession,
  CompleteRegistrationRequest,
  RegistrationVerification,
} from './auth.types';
import { normalizePhone } from './normalizePhone';
import { restoreSession, type SessionRestore } from './usecases/restoreSession';

export type VerificationDestination =
  | { destination: 'home'; session: AuthSession }
  | { destination: 'registration'; registrationToken: string; fullName?: string; address?: string | null }
  | { destination: 'sign_in' };

export type SignInCodeRequest =
  | { status: 'pending'; phone: string }
  | { status: 'unavailable' };

export function destinationForVerification(result: RegistrationVerification): VerificationDestination {
  if ('accessToken' in result) {
    return { destination: 'home', session: result };
  }
  if (result.status === 'sign_in') {
    return { destination: 'sign_in' };
  }
  return {
    destination: 'registration',
    registrationToken: result.registrationToken,
    fullName: result.fullName ?? result.existing?.fullName,
    address: result.address ?? result.existing?.address,
  };
}

export async function requestCreateAccountCode(
  repository: CustomerAuthRepository,
  phone: string,
): Promise<string> {
  const normalized = normalizePhone(phone);
  await repository.startWhatsAppRegistration({ phone: normalized, whatsappConsent: true });
  return normalized;
}

export async function requestSignInCode(
  repository: CustomerAuthRepository,
  phone: string,
): Promise<SignInCodeRequest> {
  const normalized = normalizePhone(phone);
  const started = await repository.startWhatsAppLogin(normalized);
  if (started.status === 'unavailable') {
    return { status: 'unavailable' };
  }
  return { status: 'pending', phone: normalized };
}

export async function submitVerificationCode(
  repository: CustomerAuthRepository,
  flow: AuthFlow,
  phone: string,
  code: string,
): Promise<VerificationDestination> {
  const result = flow === 'whatsapp_login'
    ? await repository.verifyWhatsAppLogin(phone, code)
    : await repository.verifyWhatsAppRegistration(phone, code);
  return destinationForVerification(result);
}

export async function submitCustomerRegistration(
  repository: CustomerAuthRepository,
  request: CompleteRegistrationRequest,
): Promise<AuthSession> {
  return repository.completeWhatsAppRegistration(request);
}

export function restoreCustomerSession(
  repository: CustomerAuthRepository,
  store: CustomerSessionStore,
  now = Date.now(),
): Promise<SessionRestore> {
  return restoreSession(repository, store, now);
}
