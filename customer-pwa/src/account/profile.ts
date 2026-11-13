export const CUSTOMER_PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

const AVATAR_COLORS = [
  { backgroundColor: '#3D5A80', color: '#FFFFFF' },
  { backgroundColor: '#C46B4A', color: '#FFFFFF' },
  { backgroundColor: '#6B5478', color: '#FFFFFF' },
  { backgroundColor: '#F3E6D8', color: '#17211D' },
] as const;

export function customerInitials(input: { kind: 'INDIVIDUAL' | 'BUSINESS'; name: string | null }): string {
  const letters = (input.name ?? '').trim().split(/\s+/).map(firstLetter).filter((letter): letter is string => letter !== null);
  if (letters.length === 0) return 'R';
  if (letters.length === 1) return letters[0];
  return `${letters[0]}${letters[letters.length - 1]}`;
}

export function customerAvatarColors(customerId: string | null | undefined): { backgroundColor: string; color: string } {
  if (!customerId) return AVATAR_COLORS[0];
  let hash = 0;
  for (let index = 0; index < customerId.length; index += 1) {
    hash = (hash * 31 + customerId.charCodeAt(index)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function profileKindLabel(kind: 'INDIVIDUAL' | 'BUSINESS'): string {
  return kind === 'BUSINESS' ? 'Business' : 'Individual';
}

export function profileRows(account: {
  phone: string;
  email: string | null;
  contactName: string | null;
  appearance: string;
}): Array<{ label: string; value: string; action?: 'appearance' }> {
  const rows: Array<{ label: string; value: string; action?: 'appearance' }> = [
    { label: 'WhatsApp number', value: account.phone },
  ];
  if (account.email) rows.push({ label: 'Email address', value: account.email });
  if (account.contactName) rows.push({ label: 'Contact person', value: account.contactName });
  rows.push({ label: 'Appearance', value: account.appearance, action: 'appearance' });
  return rows;
}

export function customerPhotoFileIssue(size: number | null | undefined): string | null {
  if (size === 0) return 'Choose a profile photo';
  if (size != null && size > CUSTOMER_PROFILE_PHOTO_MAX_BYTES) return 'Profile photo is too large';
  return null;
}

function firstLetter(word: string): string | null {
  for (const character of word) {
    if (character.toLowerCase() !== character.toUpperCase()) return character.toLocaleUpperCase('en');
  }
  return null;
}
