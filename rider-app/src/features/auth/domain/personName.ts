export function normalizeRiderName(input: string): string {
  const name = input.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 200 || /[\u0000-\u001f]/.test(name)) {
    throw new Error('Full name is required');
  }
  return name;
}
