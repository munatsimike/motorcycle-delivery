export const REGISTRATION_NAME_AND_ADDRESS = 'Enter your name and address.';
export const REGISTRATION_NAME_AND_SURNAME = 'Enter your name and surname.';
export const REGISTRATION_NAME_LETTERS = 'Each name must be at least 3 letters.';
export const REGISTRATION_ADDRESS_REQUIRED = 'Address is required';

export function registrationNameFieldError(error: string | null): string | null {
  if (error === REGISTRATION_NAME_AND_SURNAME || error === REGISTRATION_NAME_LETTERS) {
    return error;
  }
  return null;
}

export function registrationDetailsIssue(fullName: string, address: string): string | null {
  const name = collapseRegistrationName(fullName);
  if (!name || !address.trim()) {
    return REGISTRATION_NAME_AND_ADDRESS;
  }
  const words = name.split(' ');
  if (words.length < 2) {
    return REGISTRATION_NAME_AND_SURNAME;
  }
  if (words.some((word) => letterCount(word) < 3)) {
    return REGISTRATION_NAME_LETTERS;
  }
  if (address.trim().length > 500) {
    return REGISTRATION_ADDRESS_REQUIRED;
  }
  return null;
}

function letterCount(word: string): number {
  return word.match(/\p{L}/gu)?.length ?? 0;
}

export function collapseRegistrationName(fullName: string): string {
  return fullName.trim().replace(/\s+/g, ' ');
}
