export const REGISTRATION_NAME_AND_ADDRESS = 'Enter your name and address.';
export const REGISTRATION_NAME_AND_SURNAME = 'Enter your name and surname.';
export const REGISTRATION_NAME_LETTERS = 'Each name must be at least 3 letters.';

export function registrationNameFieldError(error: string | null): string | null {
  if (error === REGISTRATION_NAME_AND_SURNAME || error === REGISTRATION_NAME_LETTERS) {
    return error;
  }
  return null;
}

export function registrationFullNameIssue(fullName: string, address: string): string | null {
  const name = collapseRegistrationName(fullName);
  const place = address.trim();
  if (!name || !place) {
    return REGISTRATION_NAME_AND_ADDRESS;
  }
  const words = name.split(' ');
  if (words.length < 2) {
    return REGISTRATION_NAME_AND_SURNAME;
  }
  if (words.some((word) => letterCount(word) < 3)) {
    return REGISTRATION_NAME_LETTERS;
  }
  return null;
}

function letterCount(word: string): number {
  return word.match(/\p{L}/gu)?.length ?? 0;
}

export function collapseRegistrationName(fullName: string): string {
  return fullName.trim().replace(/\s+/g, ' ');
}
