import { BadRequestException } from '@nestjs/common';
import { InvalidPersonNameError, normalizePersonName } from '../auth/person-name.js';
import { InvalidPhoneNumberError, normalizeAuthPhone } from '../auth/phone-number.js';
import { CoordinateSource, Currency, DeliveryPayer, ParcelSize, PaymentMethod } from '../generated/prisma/client.js';
import { isPlaceId } from './google-places.js';
import { readMoneyCents } from './money.js';

export type QuotePins = {
  pickupLatitude: string;
  pickupLongitude: string;
  dropoffLatitude: string;
  dropoffLongitude: string;
};

export type DeliveryDraft = QuotePins & {
  pickupAddress: string;
  pickupPlaceId: string | null;
  pickupCoordinateSource: CoordinateSource;
  pickupLandmark: string | null;
  pickupInstructions: string | null;
  pickupContactName: string;
  pickupContactPhone: string;
  dropoffAddress: string;
  dropoffPlaceId: string | null;
  dropoffCoordinateSource: CoordinateSource;
  dropoffLandmark: string | null;
  dropoffInstructions: string | null;
  dropoffContactName: string;
  dropoffContactPhone: string;
  parcelDescription: string;
  parcelSize: ParcelSize;
  parcelInstructions: string | null;
  offeredPriceCents: number;
  payer: DeliveryPayer;
  paymentMethod: PaymentMethod;
};

const PAYMENT_METHODS = new Set<string>(Object.values(PaymentMethod));

// Keep this aligned with MAXIMUM_CUSTOMER_OFFER_CENTS in the customer app.
export const MAXIMUM_CUSTOMER_OFFER_CENTS = 100_000;

export function readCustomerOfferCents(value: unknown): number {
  const cents = readMoneyCents(value, false, 'Enter an offered price');
  if (cents > MAXIMUM_CUSTOMER_OFFER_CENTS) {
    throw new BadRequestException('Enter an offer of 1000.00 or less');
  }
  return cents;
}

export function readQuotePins(body: unknown): QuotePins {
  const record = recordOf(body, 'Enter the pickup and drop-off');
  const pickup = recordOf(record.pickup, 'Enter the pickup');
  const dropoff = recordOf(record.dropoff, 'Enter the drop-off');
  return {
    pickupLatitude: readCoordinate(pickup.latitude, -90, 90, 'Enter a valid pickup location'),
    pickupLongitude: readCoordinate(pickup.longitude, -180, 180, 'Enter a valid pickup location'),
    dropoffLatitude: readCoordinate(dropoff.latitude, -90, 90, 'Enter a valid drop-off location'),
    dropoffLongitude: readCoordinate(dropoff.longitude, -180, 180, 'Enter a valid drop-off location'),
  };
}

export function readDeliveryDraft(body: unknown): DeliveryDraft {
  const record = recordOf(body, 'Enter the delivery');
  const pickup = readStop(record.pickup, 'pickup');
  const dropoff = readStop(record.dropoff, 'drop-off');
  const parcel = recordOf(record.parcel, 'Enter the parcel');
  if (record.currency !== undefined && record.currency !== Currency.USD) {
    throw new BadRequestException('USD is the only supported currency');
  }
  return {
    pickupLatitude: pickup.latitude,
    pickupLongitude: pickup.longitude,
    pickupAddress: pickup.address,
    pickupPlaceId: pickup.placeId,
    pickupCoordinateSource: pickup.coordinateSource,
    pickupLandmark: pickup.landmark,
    pickupInstructions: pickup.instructions,
    pickupContactName: pickup.contactName,
    pickupContactPhone: pickup.contactPhone,
    dropoffLatitude: dropoff.latitude,
    dropoffLongitude: dropoff.longitude,
    dropoffAddress: dropoff.address,
    dropoffPlaceId: dropoff.placeId,
    dropoffCoordinateSource: dropoff.coordinateSource,
    dropoffLandmark: dropoff.landmark,
    dropoffInstructions: dropoff.instructions,
    dropoffContactName: dropoff.contactName,
    dropoffContactPhone: dropoff.contactPhone,
    parcelDescription: readRequiredText(parcel.description, 500, 'Enter the parcel description'),
    parcelSize: readSize(parcel.size),
    parcelInstructions: readOptionalText(parcel.instructions, 500, 'Enter parcel instructions'),
    offeredPriceCents: readCustomerOfferCents(record.offeredPrice),
    payer: readPayer(record.payer),
    paymentMethod: readPaymentMethod(record.paymentMethod),
  };
}

export function readTariffInput(body: unknown) {
  const record = recordOf(body, 'Enter the pricing configuration');
  if (record.currency !== undefined && record.currency !== Currency.USD) {
    throw new BadRequestException('USD is the only supported currency');
  }
  const minimumTripMetres = readMetres(record.minimumTripMetres, 'Enter the minimum trip distance');
  const maximumTripMetres = readMetres(record.maximumTripMetres, 'Enter the maximum trip distance');
  if (maximumTripMetres <= minimumTripMetres) {
    throw new BadRequestException('Maximum trip distance must be greater than the minimum');
  }
  return {
    baseFeeCents: readMoneyCents(record.baseFee, true, 'Enter the base fee'),
    pricePerKilometreCents: readMoneyCents(record.pricePerKilometre, true, 'Enter the price per kilometre'),
    minimumTripMetres,
    maximumTripMetres,
  };
}

type StopDraft = {
  latitude: string;
  longitude: string;
  address: string;
  placeId: string | null;
  coordinateSource: CoordinateSource;
  landmark: string | null;
  instructions: string | null;
  contactName: string;
  contactPhone: string;
};

function readStop(value: unknown, label: string): StopDraft {
  const stop = recordOf(value, `Enter the ${label}`);
  const coordinateSource = readCoordinateSource(stop.coordinateSource, label);
  const placeId = readPlaceId(stop.placeId, label);
  if (coordinateSource === CoordinateSource.GOOGLE_PLACES && !placeId) {
    throw new BadRequestException(`Enter a valid ${label} location`);
  }
  if (coordinateSource === CoordinateSource.DEVICE_GEOCODER && placeId) {
    throw new BadRequestException(`Enter a valid ${label} location`);
  }
  return {
    latitude: readCoordinate(stop.latitude, -90, 90, `Enter a valid ${label} location`),
    longitude: readCoordinate(stop.longitude, -180, 180, `Enter a valid ${label} location`),
    address: readRequiredText(stop.address, 500, `Enter the ${label} address`),
    placeId,
    coordinateSource,
    landmark: readOptionalText(stop.landmark, 200, `Enter the ${label} landmark`),
    instructions: readOptionalText(stop.instructions, 500, `Enter the ${label} instructions`),
    contactName: readPerson(stop.contactName, `Enter the ${label} contact name`),
    contactPhone: readPhone(stop.contactPhone, `Enter the ${label} contact phone`),
  };
}

function readCoordinateSource(value: unknown, label: string): CoordinateSource {
  if (value === CoordinateSource.GOOGLE_PLACES || value === CoordinateSource.DEVICE_GEOCODER) {
    return value;
  }
  throw new BadRequestException(`Enter a valid ${label} location`);
}

function readPlaceId(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string' || !isPlaceId(value.trim())) {
    throw new BadRequestException(`Enter a valid ${label} location`);
  }
  return value.trim();
}

function readSize(value: unknown): ParcelSize {
  if (value === ParcelSize.SMALL || value === ParcelSize.MEDIUM || value === ParcelSize.LARGE) {
    return value;
  }
  throw new BadRequestException('Choose a parcel size');
}

function readPayer(value: unknown): DeliveryPayer {
  if (value === DeliveryPayer.SENDER || value === DeliveryPayer.RECIPIENT) {
    return value;
  }
  throw new BadRequestException('Choose who pays the rider');
}

function readPaymentMethod(value: unknown): PaymentMethod {
  if (typeof value === 'string' && PAYMENT_METHODS.has(value)) {
    return value as PaymentMethod;
  }
  throw new BadRequestException('Choose how the rider will be paid');
}

function readPerson(value: unknown, message: string): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(message);
  }
  try {
    return normalizePersonName(value);
  } catch (error) {
    if (error instanceof InvalidPersonNameError) {
      throw new BadRequestException(message);
    }
    throw error;
  }
}

function readPhone(value: unknown, message: string): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(message);
  }
  try {
    return normalizeAuthPhone(value);
  } catch (error) {
    if (error instanceof InvalidPhoneNumberError) {
      throw new BadRequestException(message);
    }
    throw error;
  }
}

function readRequiredText(value: unknown, maxLength: number, message: string): string {
  const text = readOptionalText(value, maxLength, message);
  if (!text) {
    throw new BadRequestException(message);
  }
  return text;
}

function readOptionalText(value: unknown, maxLength: number, message: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new BadRequestException(message);
  }
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text) {
    return null;
  }
  if (text.length > maxLength || /[\u0000-\u001f]/.test(text)) {
    throw new BadRequestException(message);
  }
  return text;
}

function readCoordinate(value: unknown, minimum: number, maximum: number, message: string): string {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(numeric) || numeric < minimum || numeric > maximum) {
    throw new BadRequestException(message);
  }
  return numeric.toFixed(7);
}

function readMetres(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2_000_000_000) {
    throw new BadRequestException(message);
  }
  return value;
}

function recordOf(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException(message);
  }
  return value as Record<string, unknown>;
}
