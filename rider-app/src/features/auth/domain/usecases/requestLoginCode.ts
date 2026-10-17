import { normalizeRiderPhone } from '../phone';
import type { RiderAuthRepository } from '../repositories/RiderAuthRepository';

export async function requestLoginCode(
  repository: RiderAuthRepository,
  phone: string,
): Promise<string> {
  const normalized = normalizeRiderPhone(phone);
  await repository.requestLoginCode(normalized);
  return normalized;
}
