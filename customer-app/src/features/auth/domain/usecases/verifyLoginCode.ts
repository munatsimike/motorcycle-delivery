import type { AuthSession } from '../auth.types';
import type { CustomerAuthRepository } from '../repositories/CustomerAuthRepository';

export function verifyLoginCode(
  repository: CustomerAuthRepository,
  phone: string,
  code: string,
): Promise<AuthSession> {
  return repository.verifyLoginCode(phone, code);
}
