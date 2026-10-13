export class InvalidPersonNameError extends Error {
  constructor() {
    super('Full name is required');
    this.name = 'InvalidPersonNameError';
  }
}

export function normalizePersonName(input: string): string {
  const name = input.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 200 || /[\u0000-\u001f]/.test(name)) {
    throw new InvalidPersonNameError();
  }
  return name;
}
