import { hasGivenNameAndSurname } from '../text/format.ts';

export const REGISTRATION_NAME_AND_ADDRESS = 'Enter your name and address.';
export const REGISTRATION_NAME_AND_SURNAME = 'Enter your first name and surname.';
export const REGISTRATION_ADDRESS_REQUIRED = 'Address is required';

export function registrationNameFieldError(error: string | null): string | null {
  if (error === REGISTRATION_NAME_AND_SURNAME) return error;
  return null;
}

export function registrationDetailsIssue(fullName: string, address: string): string | null {
  const name = collapseRegistrationName(fullName);
  if (!name || !address.trim()) return REGISTRATION_NAME_AND_ADDRESS;
  if (!hasGivenNameAndSurname(name)) return REGISTRATION_NAME_AND_SURNAME;
  if (address.trim().length > 500) return REGISTRATION_ADDRESS_REQUIRED;
  return null;
}

export function collapseRegistrationName(fullName: string): string {
  return fullName.trim().replace(/\s+/g, ' ');
}
