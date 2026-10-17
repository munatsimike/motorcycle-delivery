import { normalizeRiderName } from '../personName';
import { normalizeRiderPhone } from '../phone';
import type { RiderAuthRepository } from '../repositories/RiderAuthRepository';

export async function requestRegistrationCode(
  repository: RiderAuthRepository,
  phone: string,
  fullName: string,
): Promise<{ phone: string; fullName: string }> {
  const normalizedPhone = normalizeRiderPhone(phone);
  const normalizedName = normalizeRiderName(fullName);
  await repository.requestRegistrationCode(normalizedPhone, normalizedName);
  return { phone: normalizedPhone, fullName: normalizedName };
}
