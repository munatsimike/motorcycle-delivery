const NAME_WORD = /^[\p{L}]+(?:['’-][\p{L}]+)*$/u;
const PLACE_ABBREVIATION = /^(?=.*\p{L})[\p{Lu}\d]{2,4}$/u;
const ADDRESS_ABBREVIATIONS = new Set(['CBD', 'PO', 'NW', 'NE', 'SW', 'SE']);

export function collapseSpaces(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function hasGivenNameAndSurname(value: string): boolean {
  const words = collapseSpaces(value).split(' ').filter(Boolean);
  return words.length >= 2 && words.every((word) => NAME_WORD.test(word));
}

export function formatPersonName(value: string): string {
  return collapseSpaces(value).split(' ').filter(Boolean).map(formatNameWord).join(' ');
}

export function formatManualAddress(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .split(',')
    .map((part) => part.trim().split(' ').filter(Boolean).map(formatPlaceWord).join(' '))
    .filter(Boolean)
    .join(', ');
}

export function addressTextForSave(
  address: string,
  coordinateSource: 'GOOGLE_PLACES' | 'DEVICE_GEOCODER' | null,
): string {
  const collapsed = collapseSpaces(address);
  if (coordinateSource) return collapsed;
  return formatManualAddress(collapsed);
}

function formatPlaceWord(word: string): string {
  const abbreviation = word.toLocaleUpperCase();
  if (ADDRESS_ABBREVIATIONS.has(abbreviation)) return abbreviation;
  if (PLACE_ABBREVIATION.test(word)) return word;
  const leadingNumber = /^(\d+)([\p{L}'’-].*)$/u.exec(word);
  if (leadingNumber) {
    const suffix = leadingNumber[2] ?? '';
    if (PLACE_ABBREVIATION.test(suffix)) return `${leadingNumber[1]}${suffix}`;
    return `${leadingNumber[1]}${formatNameWord(suffix)}`;
  }
  if (/^\d/.test(word)) return word;
  return formatNameWord(word);
}

function formatNameWord(word: string): string {
  if (/^mc[\p{L}]/iu.test(word) && word.length > 3) {
    const rest = word.slice(2);
    return `Mc${rest.charAt(0).toLocaleUpperCase()}${rest.slice(1).toLocaleLowerCase()}`;
  }
  return word.split(/([-’'])/).map((part) => {
    if (part === '-' || part === "'" || part === '’' || part.length === 0) return part;
    return part.charAt(0).toLocaleUpperCase() + part.slice(1).toLocaleLowerCase();
  }).join('');
}
