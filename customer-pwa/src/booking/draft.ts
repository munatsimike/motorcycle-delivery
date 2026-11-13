export const SERVICE_CLASSES = ['EXPRESS', 'FLEXIBLE'] as const;
export type ServiceClass = (typeof SERVICE_CLASSES)[number];
export type ParcelSize = 'SMALL' | 'MEDIUM' | 'LARGE';
export type PaymentMethod = 'CASH' | 'ECOCASH' | 'ONEMONEY' | 'INNBUCKS' | 'ZIPIT';

export type StopDraft = {
  address: string;
  resolvedAddress: string;
  landmark: string;
  instructions: string;
  contactName: string;
  contactPhone: string;
  latitude: string;
  longitude: string;
  approximate: boolean;
  precision: 'exact' | 'area' | 'unverified' | null;
  placeId: string | null;
  coordinateSource: 'GOOGLE_PLACES' | 'DEVICE_GEOCODER' | null;
};

export type BookingDraft = {
  pickup: StopDraft;
  dropoff: StopDraft;
  description: string;
  size: ParcelSize | null;
  instructions: string;
  paymentMethod: PaymentMethod | null;
  serviceClass: ServiceClass | null;
};

export type PreparedStop = {
  latitude: number;
  longitude: number;
  address: string;
  landmark: string | null;
  instructions: string | null;
  contactName: string;
  contactPhone: string;
  placeId: string | null;
  coordinateSource: 'GOOGLE_PLACES' | 'DEVICE_GEOCODER';
};

export type PreparedBooking = {
  pickup: PreparedStop;
  dropoff: PreparedStop;
  parcel: { description: string; size: ParcelSize; instructions: string | null };
  paymentMethod: PaymentMethod | null;
  serviceClass: ServiceClass;
  pinKey: string;
};

const ZIMBABWE_MOBILE = /^\+2637\d{8}$/;
const DUTCH_MOBILE = /^\+316\d{8}$/;

export function emptyStop(): StopDraft {
  return {
    address: '',
    resolvedAddress: '',
    landmark: '',
    instructions: '',
    contactName: '',
    contactPhone: '',
    latitude: '',
    longitude: '',
    approximate: false,
    precision: null,
    placeId: null,
    coordinateSource: null,
  };
}

export function emptyBookingDraft(): BookingDraft {
  return {
    pickup: emptyStop(),
    dropoff: emptyStop(),
    description: 'Parcel',
    size: 'SMALL',
    instructions: '',
    paymentMethod: 'CASH',
    serviceClass: 'FLEXIBLE',
  };
}

export function contactPhoneForField(input: string): string {
  return dutchMobileE164(input) ?? zimbabweNationalNumber(input) ?? '';
}

export function deliveryContactPhone(input: string): string | null {
  return zimbabweMobileE164(input) ?? dutchMobileE164(input);
}

export function zimbabweNationalNumber(input: string): string | null {
  const e164 = zimbabweMobileE164(input);
  return e164 ? e164.slice(4) : null;
}

export function zimbabweMobileE164(input: string): string | null {
  const national = compactDigits(input);
  if (!national) return null;
  let next = national;
  if (next.startsWith('0')) next = `263${next.slice(1)}`;
  else if (next.length === 9 && next.startsWith('7')) next = `263${next}`;
  if (next.startsWith('2630')) next = `263${next.slice(4)}`;
  const e164 = `+${next}`;
  return ZIMBABWE_MOBILE.test(e164) ? e164 : null;
}

export function dutchMobileE164(input: string): string | null {
  const national = compactDigits(input);
  if (!national) return null;
  let next = national;
  if (/^06\d{8}$/.test(next)) next = `316${next.slice(2)}`;
  else if (/^6\d{8}$/.test(next)) next = `31${next}`;
  const e164 = `+${next}`;
  return DUTCH_MOBILE.test(e164) ? e164 : null;
}

export function displayPhone(value: string): string {
  const e164 = deliveryContactPhone(value);
  if (!e164) return value.trim();
  if (e164.startsWith('+263')) return `+263 ${e164.slice(4)}`;
  if (e164.startsWith('+31')) return `+31 ${e164.slice(3)}`;
  return e164;
}

export function stopEntryError(stop: StopDraft, label: 'pickup' | 'drop-off'): string | null {
  const details = readStopText(stop, label);
  return details.ok ? null : details.error;
}

export function parcelError(draft: BookingDraft): string | null {
  if (!requiredText(draft.description, 500)) return 'Choose parcel, document, or food';
  if (!draft.size) return 'Choose a parcel size';
  if (optionalText(draft.instructions, 500) === undefined) return 'Enter parcel instructions';
  if (draft.serviceClass !== 'EXPRESS' && draft.serviceClass !== 'FLEXIBLE') return 'Choose Urgent or Flexible';
  return null;
}

export function selectParcelContent(description: 'Parcel' | 'Document' | 'Food'): Partial<BookingDraft> {
  return { description, size: 'SMALL' };
}

export function prepareBooking(draft: BookingDraft): { ok: true; booking: PreparedBooking } | { ok: false; error: string } {
  const pickup = prepareStop(draft.pickup, 'pickup');
  if (!pickup.ok) return pickup;
  const dropoff = prepareStop(draft.dropoff, 'drop-off');
  if (!dropoff.ok) return dropoff;
  const description = requiredText(draft.description, 500);
  if (!description) return { ok: false, error: 'Enter the parcel description' };
  if (!draft.size) return { ok: false, error: 'Choose a parcel size' };
  const instructions = optionalText(draft.instructions, 500);
  if (instructions === undefined) return { ok: false, error: 'Enter parcel instructions' };
  if (draft.serviceClass !== 'EXPRESS' && draft.serviceClass !== 'FLEXIBLE') {
    return { ok: false, error: 'Choose Urgent or Flexible' };
  }
  return {
    ok: true,
    booking: {
      pickup: pickup.stop,
      dropoff: dropoff.stop,
      parcel: { description, size: draft.size, instructions },
      paymentMethod: draft.paymentMethod,
      serviceClass: draft.serviceClass,
      pinKey: `${pickup.stop.latitude},${pickup.stop.longitude}|${dropoff.stop.latitude},${dropoff.stop.longitude}`,
    },
  };
}

export function quoteIdentity(pinKey: string, serviceClass: ServiceClass | null): string {
  return serviceClass ? `${pinKey}|${serviceClass}` : pinKey;
}

export function quoteBody(booking: PreparedBooking) {
  return {
    pickup: { latitude: booking.pickup.latitude, longitude: booking.pickup.longitude },
    dropoff: { latitude: booking.dropoff.latitude, longitude: booking.dropoff.longitude },
    serviceClass: booking.serviceClass,
  };
}

export function v2CreateBody(booking: PreparedBooking, offeredPrice: string) {
  const body = {
    pickup: stopBody(booking.pickup),
    dropoff: stopBody(booking.dropoff),
    parcel: booking.parcel,
    serviceClass: booking.serviceClass,
    offeredPrice,
    currency: 'USD' as const,
  };
  if (!booking.paymentMethod) return body;
  return { ...body, paymentMethod: booking.paymentMethod };
}

export function clearStopLocation(address: string): Partial<StopDraft> {
  return {
    address,
    resolvedAddress: '',
    landmark: '',
    latitude: '',
    longitude: '',
    approximate: false,
    precision: null,
    placeId: null,
    coordinateSource: null,
  };
}

export function applyResolvedStop(stop: StopDraft, location: {
  label: string;
  latitude: string;
  longitude: string;
  provider: 'google_places' | 'device';
  placeId: string | null;
  precision: 'exact' | 'area' | 'unverified';
}): StopDraft {
  return {
    ...stop,
    address: location.label,
    landmark: location.precision === 'exact' ? stop.landmark : typedHouseNumber(stop.address, location.precision),
    latitude: location.latitude,
    longitude: location.longitude,
    approximate: location.precision !== 'exact',
    precision: location.precision,
    placeId: location.placeId,
    coordinateSource: location.provider === 'google_places' ? 'GOOGLE_PLACES' : 'DEVICE_GEOCODER',
  };
}

export function typedHouseNumber(typedAddress: string, precision: 'exact' | 'area' | 'unverified'): string {
  if (precision === 'exact') return '';
  return typedAddress.trim().replace(/\s+/g, ' ').slice(0, 200);
}

export function paymentMethodLabel(method: PaymentMethod): string {
  if (method === 'ECOCASH') return 'EcoCash';
  if (method === 'ONEMONEY') return 'OneMoney';
  if (method === 'INNBUCKS') return 'InnBucks';
  if (method === 'ZIPIT') return 'ZIPIT';
  return 'Cash';
}

export function describeParcel(draft: BookingDraft): string {
  const description = draft.description.trim();
  if (description === 'Parcel' || description === 'Document' || description === 'Food') return description;
  return description;
}

function prepareStop(stop: StopDraft, label: 'pickup' | 'drop-off'): { ok: true; stop: PreparedStop } | { ok: false; error: string } {
  const details = readStopText(stop, label);
  if (!details.ok) return details;
  if (stop.coordinateSource !== 'GOOGLE_PLACES' && stop.coordinateSource !== 'DEVICE_GEOCODER') {
    return { ok: false, error: `Choose the ${label} address` };
  }
  if (stop.coordinateSource === 'GOOGLE_PLACES' && !stop.placeId) return { ok: false, error: `Choose the ${label} address` };
  if (stop.coordinateSource === 'DEVICE_GEOCODER' && stop.placeId) return { ok: false, error: `Choose the ${label} address` };
  const latitude = readCoordinate(stop.latitude, -90, 90);
  const longitude = readCoordinate(stop.longitude, -180, 180);
  if (latitude === null || longitude === null) return { ok: false, error: `Enter a valid ${label} location` };
  return { ok: true, stop: { latitude, longitude, ...details.stop, placeId: stop.placeId, coordinateSource: stop.coordinateSource } };
}

function readStopText(stop: StopDraft, label: 'pickup' | 'drop-off') {
  const visible = requiredText(stop.address, 500);
  if (!visible) return { ok: false as const, error: `Enter the ${label} address` };
  const stored = optionalText(stop.resolvedAddress, 500);
  const address = typeof stored === 'string' ? stored : visible;
  const landmark = optionalText(stop.landmark, 200);
  if (landmark === undefined) return { ok: false as const, error: `Enter the ${label} landmark` };
  const instructions = optionalText(stop.instructions, 500);
  if (instructions === undefined) return { ok: false as const, error: `Enter the ${label} instructions` };
  const contactName = requiredText(stop.contactName, 200);
  if (!contactName) return { ok: false as const, error: `Enter the ${label} contact name` };
  const contactPhone = deliveryContactPhone(stop.contactPhone);
  if (!contactPhone) return { ok: false as const, error: `Enter the ${label} contact phone` };
  return { ok: true as const, stop: { address, landmark, instructions, contactName, contactPhone } };
}

function stopBody(stop: PreparedStop) {
  return {
    latitude: stop.latitude,
    longitude: stop.longitude,
    address: stop.address,
    placeId: stop.placeId,
    coordinateSource: stop.coordinateSource,
    landmark: stop.landmark,
    instructions: stop.instructions,
    contactName: stop.contactName,
    contactPhone: stop.contactPhone,
  };
}

function compactDigits(input: string): string | null {
  const compact = input.trim().replace(/[\s().-]/g, '');
  if (!compact) return null;
  const digits = compact.startsWith('+') ? compact.slice(1) : compact;
  if (!/^\d+$/.test(digits)) return null;
  return digits.startsWith('00') ? digits.slice(2) : digits;
}

function readCoordinate(value: string, minimum: number, maximum: number): number | null {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric < minimum || numeric > maximum) return null;
  return numeric;
}

function requiredText(value: string, maxLength: number): string | null {
  const text = collapse(value);
  if (!text || text.length > maxLength || hasControlCharacter(text)) return null;
  return text;
}

function optionalText(value: string, maxLength: number): string | null | undefined {
  const text = collapse(value);
  if (!text) return null;
  if (text.length > maxLength || hasControlCharacter(text)) return undefined;
  return text;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) <= 31) return true;
  }
  return false;
}

function collapse(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}
