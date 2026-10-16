import { normalizePhone } from '../normalizePhone';
import type { CustomerAuthRepository } from '../repositories/CustomerAuthRepository';

export async function requestLoginCode(
  repository: CustomerAuthRepository,
  phone: string,
): Promise<string> {
  const normalized = normalizePhone(phone);
  await repository.requestLoginCode(normalized);
  return normalized;
}
