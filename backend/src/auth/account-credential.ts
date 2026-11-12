export function hasAccountCredential(user: {
  phoneVerifiedAt: Date | null;
}): boolean {
  return user.phoneVerifiedAt !== null;
}
