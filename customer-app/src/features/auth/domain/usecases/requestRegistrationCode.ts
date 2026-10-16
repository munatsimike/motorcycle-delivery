import { normalizePhone } from '../normalizePhone';
import type { CustomerAuthRepository } from '../repositories/CustomerAuthRepository';

export async function requestRegistrationCode(
  repository: CustomerAuthRepository,
  phone: string,
): Promise<string> {
  const normalized = normalizePhone(phone);
  await repository.requestRegistrationCode(normalized);
  return normalized;
}
