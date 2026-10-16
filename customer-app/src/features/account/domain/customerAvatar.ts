import { colors } from '../../../theme';

export type CustomerAvatarColors = {
  backgroundColor: string;
  color: string;
};

const avatarColors: readonly CustomerAvatarColors[] = [
  { backgroundColor: '#3D5A80', color: colors.textInverse },
  { backgroundColor: '#C46B4A', color: colors.textInverse },
  { backgroundColor: '#6B5478', color: colors.textInverse },
  { backgroundColor: '#F3E6D8', color: colors.text },
];

export function customerInitials(input: {
  kind: 'INDIVIDUAL' | 'BUSINESS';
  name: string | null | undefined;
}): string {
  const source = input.kind === 'BUSINESS' ? input.name : input.name;
  const letters = (source ?? '')
    .trim()
    .split(/\s+/)
    .map(firstLetter)
    .filter((letter): letter is string => letter !== null);

  if (letters.length === 0) {
    return 'R';
  }
  if (letters.length === 1) {
    return letters[0];
  }
  return `${letters[0]}${letters[letters.length - 1]}`;
}

export function customerAvatarColors(customerId: string | null | undefined): CustomerAvatarColors {
  if (!customerId) {
    return avatarColors[0];
  }

  let hash = 0;
  for (let index = 0; index < customerId.length; index += 1) {
    hash = (hash * 31 + customerId.charCodeAt(index)) >>> 0;
  }
  return avatarColors[hash % avatarColors.length];
}

function firstLetter(word: string): string | null {
  for (const character of word) {
    if (character.toLowerCase() !== character.toUpperCase()) {
      return character.toLocaleUpperCase('en');
    }
  }
  return null;
}
