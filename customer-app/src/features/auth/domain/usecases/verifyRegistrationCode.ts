import type { RegistrationProof } from '../auth.types';
import type { CustomerAuthRepository } from '../repositories/CustomerAuthRepository';

export function verifyRegistrationCode(
  repository: CustomerAuthRepository,
  phone: string,
  code: string,
): Promise<RegistrationProof> {
  return repository.verifyRegistrationCode(phone, code);
}
