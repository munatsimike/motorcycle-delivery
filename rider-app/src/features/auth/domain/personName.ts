export const RIDER_NAME_AND_SURNAME = 'Enter your name and surname.';
export const RIDER_NAME_LETTERS = 'Each name must be at least 3 letters.';

export function riderNameFieldError(error: string | null): string | null {
  if (error === RIDER_NAME_AND_SURNAME || error === RIDER_NAME_LETTERS) {
    return error;
  }
  return null;
}

export function normalizeRiderName(input: string): string {
  const name = input.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 200 || /[\u0000-\u001f]/.test(name)) {
    throw new Error('Full name is required');
  }
  const words = name.split(' ');
  if (words.length < 2) {
    throw new Error(RIDER_NAME_AND_SURNAME);
  }
  if (words.some((word) => (word.match(/\p{L}/gu)?.length ?? 0) < 3)) {
    throw new Error(RIDER_NAME_LETTERS);
  }
  return name;
}
