import type { LoginStart } from '../auth.types';
import { normalizePhone } from '../normalizePhone';
import type { CustomerAuthRepository } from '../repositories/CustomerAuthRepository';

export type LoginCodeResult = { status: 'pending'; phone: string } | { status: 'unavailable' };

export async function requestLoginCode(
  repository: CustomerAuthRepository,
  phone: string,
): Promise<LoginCodeResult> {
  const normalized = normalizePhone(phone);
  const started: LoginStart = await repository.requestLoginCode(normalized);
  if (started.status === 'unavailable') {
    return { status: 'unavailable' };
  }
  return { status: 'pending', phone: normalized };
}
