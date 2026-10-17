export const PARCEL_SIZES = ['SMALL', 'MEDIUM', 'LARGE'] as const;
export type ParcelSize = (typeof PARCEL_SIZES)[number];

export const DELIVERY_PAYERS = ['SENDER', 'RECIPIENT'] as const;
export type DeliveryPayer = (typeof DELIVERY_PAYERS)[number];

export const PAYMENT_METHODS = ['CASH', 'ECOCASH', 'ONEMONEY', 'INNBUCKS', 'ZIPIT'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type StopDraft = {
  address: string;
  landmark: string;
  instructions: string;
  contactName: string;
  contactPhone: string;
  latitude: string;
  longitude: string;
};

export type BookingDraft = {
  pickup: StopDraft;
  dropoff: StopDraft;
  description: string;
  size: ParcelSize | null;
  instructions: string;
  payer: DeliveryPayer | null;
  paymentMethod: PaymentMethod | null;
};

export type PreparedStop = {
  latitude: number;
  longitude: number;
  address: string;
  landmark: string | null;
  instructions: string | null;
  contactName: string;
  contactPhone: string;
};

export type PreparedBooking = {
  pickup: PreparedStop;
  dropoff: PreparedStop;
  parcel: {
    description: string;
    size: ParcelSize;
    instructions: string | null;
  };
  payer: DeliveryPayer;
  paymentMethod: PaymentMethod;
  pinKey: string;
};

const ZIMBABWE_MOBILE = /^\+2637\d{8}$/;

export function emptyStop(): StopDraft {
  return {
    address: '',
    landmark: '',
    instructions: '',
    contactName: '',
    contactPhone: '',
    latitude: '',
    longitude: '',
  };
}

export function emptyBookingDraft(): BookingDraft {
  return {
    pickup: emptyStop(),
    dropoff: emptyStop(),
    description: 'Parcel',
    size: 'SMALL',
    instructions: '',
    payer: 'SENDER',
    paymentMethod: 'CASH',
  };
}

export function prepareBooking(draft: BookingDraft): { ok: true; booking: PreparedBooking } | { ok: false; error: string } {
  const pickup = prepareStop(draft.pickup, 'pickup');
  if (!pickup.ok) {
    return pickup;
  }
  const dropoff = prepareStop(draft.dropoff, 'drop-off');
  if (!dropoff.ok) {
    return dropoff;
  }
  const description = requiredText(draft.description, 500);
  if (!description) {
    return { ok: false, error: 'Enter the parcel description' };
  }
  if (!draft.size) {
    return { ok: false, error: 'Choose a parcel size' };
  }
  const instructions = optionalText(draft.instructions, 500);
  if (instructions === undefined) {
    return { ok: false, error: 'Enter parcel instructions' };
  }
  if (!draft.payer) {
    return { ok: false, error: 'Choose who pays the rider' };
  }
  if (!draft.paymentMethod) {
    return { ok: false, error: 'Choose how the rider will be paid' };
  }
  return {
    ok: true,
    booking: {
      pickup: pickup.stop,
      dropoff: dropoff.stop,
      parcel: {
        description,
        size: draft.size,
        instructions,
      },
      payer: draft.payer,
      paymentMethod: draft.paymentMethod,
      pinKey: pinKey(pickup.stop, dropoff.stop),
    },
  };
}

export function quoteBody(booking: PreparedBooking) {
  return {
    pickup: {
      latitude: booking.pickup.latitude,
      longitude: booking.pickup.longitude,
    },
    dropoff: {
      latitude: booking.dropoff.latitude,
      longitude: booking.dropoff.longitude,
    },
  };
}

export function createBody(booking: PreparedBooking, offeredPrice: string) {
  return {
    pickup: stopBody(booking.pickup),
    dropoff: stopBody(booking.dropoff),
    parcel: booking.parcel,
    offeredPrice,
    payer: booking.payer,
    paymentMethod: booking.paymentMethod,
    currency: 'USD' as const,
  };
}

export function stopError(stop: StopDraft, label: 'pickup' | 'drop-off'): string | null {
  const prepared = prepareStop(stop, label);
  return prepared.ok ? null : prepared.error;
}

export function stopDetailsError(stop: StopDraft, label: 'pickup' | 'drop-off'): string | null {
  const details = readStopDetails(stop, label);
  return details.ok ? null : details.error;
}

export function parcelError(draft: BookingDraft): string | null {
  const description = requiredText(draft.description, 500);
  if (!description) {
    return 'Choose parcel, document, or food';
  }
  if (!draft.size) {
    return 'Choose a parcel size';
  }
  const instructions = optionalText(draft.instructions, 500);
  if (instructions === undefined) {
    return 'Enter parcel instructions';
  }
  if (!draft.payer) {
    return 'Choose who pays the rider';
  }
  if (!draft.paymentMethod) {
    return 'Choose how the rider will be paid';
  }
  return null;
}

function prepareStop(
  stop: StopDraft,
  label: 'pickup' | 'drop-off',
): { ok: true; stop: PreparedStop } | { ok: false; error: string } {
  const details = readStopDetails(stop, label);
  if (!details.ok) {
    return details;
  }
  const latitude = readCoordinate(stop.latitude, -90, 90);
  const longitude = readCoordinate(stop.longitude, -180, 180);
  if (latitude === null || longitude === null) {
    return { ok: false, error: `Enter a valid ${label} location` };
  }
  return {
    ok: true,
    stop: {
      latitude,
      longitude,
      ...details.stop,
    },
  };
}

function readStopDetails(
  stop: StopDraft,
  label: 'pickup' | 'drop-off',
): { ok: true; stop: Omit<PreparedStop, 'latitude' | 'longitude'> } | { ok: false; error: string } {
  const address = requiredText(stop.address, 500);
  if (!address) {
    return { ok: false, error: `Enter the ${label} address` };
  }
  const landmark = optionalText(stop.landmark, 200);
  if (landmark === undefined) {
    return { ok: false, error: `Enter the ${label} landmark` };
  }
  const instructions = optionalText(stop.instructions, 500);
  if (instructions === undefined) {
    return { ok: false, error: `Enter the ${label} instructions` };
  }
  const contactName = requiredText(stop.contactName, 200);
  if (!contactName) {
    return { ok: false, error: `Enter the ${label} contact name` };
  }
  const contactPhone = deliveryContactPhone(stop.contactPhone);
  if (!contactPhone) {
    return { ok: false, error: `Enter the ${label} contact phone` };
  }
  return {
    ok: true,
    stop: {
      address,
      landmark,
      instructions,
      contactName,
      contactPhone,
    },
  };
}

function stopBody(stop: PreparedStop) {
  return {
    latitude: stop.latitude,
    longitude: stop.longitude,
    address: stop.address,
    landmark: stop.landmark,
    instructions: stop.instructions,
    contactName: stop.contactName,
    contactPhone: stop.contactPhone,
  };
}

function pinKey(pickup: PreparedStop, dropoff: PreparedStop): string {
  return `${pickup.latitude},${pickup.longitude}|${dropoff.latitude},${dropoff.longitude}`;
}

function readCoordinate(value: string, minimum: number, maximum: number): number | null {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return null;
  }
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric < minimum || numeric > maximum) {
    return null;
  }
  return numeric;
}

function requiredText(value: string, maxLength: number): string | null {
  const text = collapse(value);
  if (!text || text.length > maxLength || /[\u0000-\u001f]/.test(text)) {
    return null;
  }
  return text;
}

function optionalText(value: string, maxLength: number): string | null | undefined {
  const text = collapse(value);
  if (!text) {
    return null;
  }
  if (text.length > maxLength || /[\u0000-\u001f]/.test(text)) {
    return undefined;
  }
  return text;
}

function collapse(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function zimbabweNationalNumber(input: string): string | null {
  const e164 = zimbabweMobileE164(input);
  return e164 ? e164.slice(4) : null;
}

/** Value stored on the pickup form: Zimbabwe digits beside +263, or a Dutch number in full. */
export function contactPhoneForField(input: string): string {
  return dutchMobileE164(input) ?? zimbabweNationalNumber(input) ?? '';
}

export function deliveryContactPhone(input: string): string | null {
  return zimbabweMobileE164(input) ?? dutchMobileE164(input);
}

const DUTCH_MOBILE = /^\+316\d{8}$/;

export function dutchMobileE164(input: string): string | null {
  const compact = input.trim().replace(/[\s().-]/g, '');
  if (!compact) {
    return null;
  }
  const digits = compact.startsWith('+') ? compact.slice(1) : compact;
  if (!/^\d+$/.test(digits)) {
    return null;
  }
  let national = digits;
  if (national.startsWith('00')) {
    national = national.slice(2);
  }
  if (/^06\d{8}$/.test(national)) {
    national = `316${national.slice(2)}`;
  } else if (/^6\d{8}$/.test(national)) {
    national = `31${national}`;
  }
  const e164 = `+${national}`;
  return DUTCH_MOBILE.test(e164) ? e164 : null;
}

export function zimbabweMobileE164(input: string): string | null {
  const compact = input.trim().replace(/[\s().-]/g, '');
  if (!compact) {
    return null;
  }
  const digits = compact.startsWith('+') ? compact.slice(1) : compact;
  if (!/^\d+$/.test(digits)) {
    return null;
  }
  let national = digits;
  if (national.startsWith('00')) {
    national = national.slice(2);
  }
  if (national.startsWith('0')) {
    national = `263${national.slice(1)}`;
  } else if (national.length === 9 && national.startsWith('7')) {
    national = `263${national}`;
  }
  if (national.startsWith('2630')) {
    national = `263${national.slice(4)}`;
  }
  const e164 = `+${national}`;
  return ZIMBABWE_MOBILE.test(e164) ? e164 : null;
}
