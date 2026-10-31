const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const CARD_CITIES = new Set([
  'harare',
  'bulawayo',
  'chitungwiza',
  'mutare',
  'epworth',
  'gweru',
  'kwekwe',
  'kadoma',
  'masvingo',
  'chinhoyi',
  'norton',
  'marondera',
  'ruwa',
  'chegutu',
  'zvishavane',
  'bindura',
  'beitbridge',
  'redcliff',
  'victoria falls',
  'hwange',
  'chiredzi',
  'kariba',
  'karoi',
  'chipinge',
  'gwanda',
  'shurugwi',
]);

export function deliveryDetailAddress(address: string): string {
  const parts = addressParts(address);
  dropCountry(parts);
  return parts.join(', ');
}

const STREET_TYPES: Record<string, string> = {
  road: 'Rd',
  street: 'St',
  avenue: 'Ave',
  close: 'Cl',
  drive: 'Dr',
  crescent: 'Cres',
  lane: 'Ln',
  court: 'Ct',
  place: 'Pl',
  boulevard: 'Blvd',
  terrace: 'Ter',
};

const STREET_TYPE_PATTERN = new RegExp(`\\b(${Object.keys(STREET_TYPES).join('|')})\\b`, 'gi');

export type DeliveryContentKind = 'parcel' | 'document' | 'food';

export function deliveryContentKind(description: string | null | undefined): DeliveryContentKind {
  const value = description?.trim().toLowerCase() ?? '';
  if (value === 'food') {
    return 'food';
  }
  if (value === 'document' || value === 'documents' || value === 'doc') {
    return 'document';
  }
  return 'parcel';
}

export function deliveryCardAddress(address: string): string {
  const parts = addressParts(address);
  dropCountry(parts);
  if (parts.length > 1 && CARD_CITIES.has(parts[parts.length - 1].toLowerCase())) {
    parts.pop();
  }
  return parts.map(abbreviateStreetType).join(', ');
}

function abbreviateStreetType(part: string): string {
  return part.replace(STREET_TYPE_PATTERN, (word) => STREET_TYPES[word.toLowerCase()] ?? word);
}

function addressParts(address: string): string[] {
  return address.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
}

function dropCountry(parts: string[]) {
  if (parts.length > 1 && parts[parts.length - 1].toLowerCase() === 'zimbabwe') {
    parts.pop();
  }
}

export function shortDeliveryReference(id: string): string {
  const compact = id.replace(/[^a-zA-Z0-9]/g, '');
  const tail = compact.slice(-5).toUpperCase();
  return tail.length > 0 ? `#${tail}` : id;
}

export function deliveryWhenLabel(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const dateText = `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  return `${dateText} • ${hours}:${minutes}`;
}
