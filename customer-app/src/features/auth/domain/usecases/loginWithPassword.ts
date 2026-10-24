import type { AuthSession } from '../auth.types';
import { normalizePhone } from '../normalizePhone';
import type { CustomerAuthRepository } from '../repositories/CustomerAuthRepository';

export function loginWithPassword(
  repository: CustomerAuthRepository,
  phone: string,
  password: string,
): Promise<AuthSession> {
  return repository.loginWithPassword(normalizePhone(phone), password);
}
