import type { AuthSession } from '../auth.types';
import type { RiderAuthRepository } from '../repositories/RiderAuthRepository';

export function verifyLoginCode(
  repository: RiderAuthRepository,
  phone: string,
  code: string,
): Promise<AuthSession> {
  return repository.verifyLoginCode(phone, code);
}
