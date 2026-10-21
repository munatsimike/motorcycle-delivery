import type { RegistrationVerification } from '../auth.types';
import type { CustomerAuthRepository } from '../repositories/CustomerAuthRepository';

export function verifyRegistrationCode(
  repository: CustomerAuthRepository,
  phone: string,
  code: string,
): Promise<RegistrationVerification> {
  return repository.verifyRegistrationCode(phone, code);
}
