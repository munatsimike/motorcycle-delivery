export const SERVICE_CLASSES = ['EXPRESS', 'FLEXIBLE'] as const;
export type ServiceClass = (typeof SERVICE_CLASSES)[number];
export type ParcelSize = 'SMALL' | 'MEDIUM' | 'LARGE';
export type PaymentMethod = 'CASH' | 'ECOCASH' | 'ONEMONEY' | 'INNBUCKS' | 'ZIPIT';
export type BookingCurrency = 'USD' | 'ZWG';

// Preserve the currency selected by the customer. The backend remains responsible
// for accepting or rejecting ZiG bookings; never silently turn ZiG into USD.
export function requestBookingCurrency(currency: BookingCurrency | null | undefined): BookingCurrency {
  return currency === 'ZWG' ? 'ZWG' : 'USD';
}

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
  currency: BookingCurrency;
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
  currency: BookingCurrency;
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

export function replaceBookingStop(draft: BookingDraft, side: 'pickup' | 'dropoff', patch: Partial<StopDraft>): BookingDraft {
  return { ...draft, [side]: { ...draft[side], ...patch } };
}

export function bookingDraftFromDelivery(source: {
  pickupAddress: string;
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  senderName: string | null;
  pickupContactPhone: string | null;
  pickupLandmark: string | null;
  pickupInstructions: string | null;
  dropoffAddress: string;
  dropoffLatitude: number | null;
  dropoffLongitude: number | null;
  recipientName: string | null;
  recipientPhone: string | null;
  dropoffLandmark: string | null;
  dropoffInstructions: string | null;
  parcelDescription: string;
  parcelSize: ParcelSize | null;
  parcelInstructions: string | null;
  paymentMethod: PaymentMethod | null;
  serviceClass: ServiceClass | null;
  currency?: string | null;
}): BookingDraft {
  return {
    pickup: rebookStop(source.pickupAddress, source.pickupLatitude, source.pickupLongitude, source.senderName, source.pickupContactPhone, source.pickupLandmark, source.pickupInstructions),
    dropoff: rebookStop(source.dropoffAddress, source.dropoffLatitude, source.dropoffLongitude, source.recipientName, source.recipientPhone, source.dropoffLandmark, source.dropoffInstructions),
    description: source.parcelDescription.trim() || 'Parcel',
    size: source.parcelSize ?? 'SMALL',
    instructions: source.parcelInstructions ?? '',
    paymentMethod: source.paymentMethod ?? 'CASH',
    serviceClass: source.serviceClass ?? 'FLEXIBLE',
    currency: source.currency === 'ZWG' ? 'ZWG' : 'USD',
  };
}

export function bookingDraftFromLocation(state: unknown): BookingDraft {
  if (!isDraftRecord(state) || !isDraftRecord(state.rebook)) return emptyBookingDraft();
  const draft = state.rebook;
  if (!isStopDraft(draft.pickup) || !isStopDraft(draft.dropoff)) return emptyBookingDraft();
  const empty = emptyBookingDraft();
  return {
    ...empty,
    description: typeof draft.description === 'string' ? draft.description : empty.description,
    size: draft.size === 'SMALL' || draft.size === 'MEDIUM' || draft.size === 'LARGE' ? draft.size : empty.size,
    instructions: typeof draft.instructions === 'string' ? draft.instructions : '',
    paymentMethod: isPaymentMethod(draft.paymentMethod) ? draft.paymentMethod : empty.paymentMethod,
    serviceClass: draft.serviceClass === 'EXPRESS' || draft.serviceClass === 'FLEXIBLE' ? draft.serviceClass : empty.serviceClass,
    currency: draft.currency === 'ZWG' ? 'ZWG' : 'USD',
    pickup: { ...emptyStop(), ...draft.pickup },
    dropoff: { ...emptyStop(), ...draft.dropoff },
  };
}

function rebookStop(
  address: string,
  latitude: number | null,
  longitude: number | null,
  contactName: string | null,
  contactPhone: string | null,
  landmark: string | null,
  instructions: string | null,
): StopDraft {
  const latitudeText = coordinateText(latitude);
  const longitudeText = coordinateText(longitude);
  const located = latitudeText !== '' && longitudeText !== '';
  return {
    address,
    resolvedAddress: address,
    landmark: landmark ?? '',
    instructions: instructions ?? '',
    contactName: contactName ?? '',
    contactPhone: contactPhone ?? '',
    latitude: latitudeText,
    longitude: longitudeText,
    approximate: false,
    precision: located ? 'exact' : null,
    placeId: null,
    coordinateSource: located ? 'DEVICE_GEOCODER' : null,
  };
}

function coordinateText(value: number | null): string {
  return value != null && Number.isFinite(value) ? String(value) : '';
}

function isDraftRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStopDraft(value: unknown): value is StopDraft {
  if (!isDraftRecord(value)) return false;
  return typeof value.address === 'string'
    && typeof value.latitude === 'string'
    && typeof value.longitude === 'string'
    && typeof value.contactName === 'string'
    && typeof value.contactPhone === 'string';
}

function isPaymentMethod(value: unknown): value is PaymentMethod {
  return value === 'CASH' || value === 'ECOCASH' || value === 'ONEMONEY' || value === 'INNBUCKS' || value === 'ZIPIT';
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
    currency: 'USD',
  };
}

export function contactPhoneForField(input: string): string {
  return dutchMobileE164(input) ?? zimbabweNationalNumber(input) ?? '';
}

export function bookingPhoneDisplay(stored: string): string {
  const compact = stored.replace(/[\s()-]/g, '');
  if (compact.startsWith('+31')) return compact.slice(3);
  if (compact.startsWith('+263')) return compact.slice(4);
  if (compact.startsWith('00263')) return compact.slice(5);
  if (/^2637\d*$/.test(compact)) return compact.slice(3);
  return stored;
}

export function bookingPhoneStored(local: string): string {
  const digits = bookingPhoneDisplay(local).replace(/\D/g, '');
  if (!digits) return '';
  return deliveryContactPhone(digits) ?? `+263${digits}`;
}

export function deliveryContactPhone(input: string): string | null {
  return zimbabweMobileE164(input) ?? dutchMobileE164(input);
}

export const ZIMBABWE_PHONE_ERROR = 'Enter a valid Zimbabwean number';

export function contactPhoneError(input: string, emptyMessage: string): string | null {
  if (!input.trim()) return emptyMessage;
  return zimbabweMobileE164(input) ? null : ZIMBABWE_PHONE_ERROR;
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
      currency: requestBookingCurrency(draft.currency),
      pinKey: `${pickup.stop.latitude},${pickup.stop.longitude}|${dropoff.stop.latitude},${dropoff.stop.longitude}`,
    },
  };
}

export function quoteIdentity(pinKey: string, serviceClass: ServiceClass | null, currency: BookingCurrency = 'USD'): string {
  const route = serviceClass ? `${pinKey}|${serviceClass}` : pinKey;
  return `${route}|${currency}`;
}

export function quoteBody(booking: PreparedBooking) {
  return {
    pickup: { latitude: booking.pickup.latitude, longitude: booking.pickup.longitude },
    dropoff: { latitude: booking.dropoff.latitude, longitude: booking.dropoff.longitude },
    serviceClass: booking.serviceClass,
    currency: requestBookingCurrency(booking.currency),
  };
}

export function v2CreateBody(booking: PreparedBooking, offeredPrice: string) {
  const body = {
    pickup: stopBody(booking.pickup),
    dropoff: stopBody(booking.dropoff),
    parcel: booking.parcel,
    serviceClass: booking.serviceClass,
    offeredPrice,
    currency: requestBookingCurrency(booking.currency),
  };
  if (!booking.paymentMethod) return body;
  return { ...body, paymentMethod: booking.paymentMethod };
}

export function applyManualPoint(stop: StopDraft, point: { latitude: string; longitude: string }): StopDraft {
  return {
    ...stop,
    latitude: point.latitude,
    longitude: point.longitude,
    approximate: true,
    precision: 'unverified',
    placeId: null,
    coordinateSource: 'DEVICE_GEOCODER',
    resolvedAddress: '',
  };
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

export function hasSelectedCoordinates(stop: StopDraft): boolean {
  const latitude = readCoordinate(stop.latitude, -90, 90);
  const longitude = readCoordinate(stop.longitude, -180, 180);
  if (latitude === null || longitude === null) return false;
  if (stop.coordinateSource === 'GOOGLE_PLACES') return Boolean(stop.placeId);
  if (stop.coordinateSource === 'DEVICE_GEOCODER') return !stop.placeId;
  return false;
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
    return { ok: false, error: `Confirm the ${label} address on the map` };
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
  const phoneError = contactPhoneError(stop.contactPhone, `Enter the ${label} contact phone`);
  if (phoneError) return { ok: false as const, error: phoneError };
  const contactPhone = zimbabweMobileE164(stop.contactPhone);
  if (!contactPhone) return { ok: false as const, error: ZIMBABWE_PHONE_ERROR };
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
