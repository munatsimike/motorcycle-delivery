import type { AuthSession } from '../auth.types';
import type { RiderAuthRepository } from '../repositories/RiderAuthRepository';

export function verifyRegistrationCode(
  repository: RiderAuthRepository,
  phone: string,
  code: string,
): Promise<AuthSession> {
  return repository.verifyRegistrationCode(phone, code);
}
