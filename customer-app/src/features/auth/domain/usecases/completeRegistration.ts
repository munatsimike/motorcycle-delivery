import type { AuthSession, CompleteRegistrationRequest } from '../auth.types';
import type { CustomerAuthRepository } from '../repositories/CustomerAuthRepository';

export async function completeRegistration(
  repository: CustomerAuthRepository,
  request: CompleteRegistrationRequest,
): Promise<AuthSession> {
  const address = cleanLine(request.address, 'Address is required.', 500);
  if (request.accountKind === 'INDIVIDUAL') {
    return repository.completeRegistration({
      registrationToken: request.registrationToken,
      accountKind: 'INDIVIDUAL',
      fullName: cleanLine(request.fullName, 'Full name is required.'),
      address,
    });
  }

  return repository.completeRegistration({
    registrationToken: request.registrationToken,
    accountKind: 'BUSINESS',
    businessName: cleanLine(request.businessName, 'Business name is required.'),
    contactName: cleanLine(request.contactName, 'Contact name is required.'),
    address,
  });
}

function cleanLine(value: string, message: string, maxLength = 200): string {
  const cleaned = value.trim().replace(/\s+/g, ' ');
  if (cleaned.length < 1 || cleaned.length > maxLength || /[\u0000-\u001f]/.test(cleaned)) {
    throw new Error(message);
  }
  return cleaned;
}
