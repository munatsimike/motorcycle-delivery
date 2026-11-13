import { normalizeRiderName } from '../personName';
import { normalizeRiderPhone } from '../phone';
import type { RiderAuthRepository } from '../repositories/RiderAuthRepository';

export async function requestRegistrationCode(
  repository: RiderAuthRepository,
  phone: string,
  fullName: string,
  address: string,
): Promise<{ phone: string; fullName: string }> {
  const normalizedPhone = normalizeRiderPhone(phone);
  const normalizedName = normalizeRiderName(fullName);
  const normalizedAddress = address.trim();
  if (normalizedAddress.length < 1 || normalizedAddress.length > 500) {
    throw new Error('Enter the address on your account.');
  }
  await repository.requestRegistrationCode(normalizedPhone, normalizedName, normalizedAddress);
  return { phone: normalizedPhone, fullName: normalizedName };
}
