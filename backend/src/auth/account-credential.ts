export function hasPasswordCredential(passwordHash: string | null | undefined): boolean {
  return typeof passwordHash === 'string' && passwordHash.startsWith('$argon2');
}

export function hasAccountCredential(user: {
  phoneVerifiedAt: Date | null;
  passwordHash?: string | null;
}): boolean {
  return user.phoneVerifiedAt !== null || hasPasswordCredential(user.passwordHash);
}
