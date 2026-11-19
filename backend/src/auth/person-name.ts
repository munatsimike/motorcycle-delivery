export class InvalidPersonNameError extends Error {
  constructor() {
    super('Full name is required');
    this.name = 'InvalidPersonNameError';
  }
}

const PERSON_NAME_WORD = /^[\p{L}]+(?:['’-][\p{L}]+)*$/u;

export function normalizePersonName(input: string): string {
  const name = input.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 200 || /[\u0000-\u001f]/.test(name)) {
    throw new InvalidPersonNameError();
  }
  return name;
}

export function hasGivenNameAndSurname(name: string): boolean {
  const words = name.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  return words.length >= 2 && words.every((word) => PERSON_NAME_WORD.test(word));
}
