import { BadRequestException } from '@nestjs/common';
import { CoordinateSource, CustomerSavedAddressLabel } from '../generated/prisma/client.js';
import { hasGivenNameAndSurname, InvalidPersonNameError, normalizePersonName } from '../auth/person-name.js';
import { InvalidPhoneNumberError, normalizeAuthPhone } from '../auth/phone-number.js';
import { isPlaceId } from '../delivery/google-places.js';

export type SavedAddressInput = {
  label: CustomerSavedAddressLabel;
  customLabel: string | null;
  address: string;
  latitude: string;
  longitude: string;
  placeId: string | null;
  coordinateSource: CoordinateSource;
  contactName: string;
  contactPhone: string;
  isDefaultPickup: boolean;
  reuseExisting: boolean;
};

export function readSavedAddress(body: unknown): SavedAddressInput {
  const record = recordOf(body);
  const label = readLabel(record.label);
  return {
    label,
    customLabel: readCustomLabel(label, record.customLabel),
    address: readRequiredText(record.address, 500, 'Enter the address'),
    latitude: readCoordinate(record.latitude, 90),
    longitude: readCoordinate(record.longitude, 180),
    ...readSource(record.placeId, record.coordinateSource),
    contactName: readPerson(record.contactName),
    contactPhone: readPhone(record.contactPhone),
    isDefaultPickup: readFlag(record.isDefaultPickup),
    reuseExisting: readFlag(record.reuseExisting),
  };
}

export function readSavedAddressPatch(body: unknown, current: SavedAddressInput): SavedAddressInput {
  const record = recordOf(body);
  const label = record.label === undefined ? current.label : readLabel(record.label);
  const customLabel = record.customLabel !== undefined
    ? record.customLabel
    : label === CustomerSavedAddressLabel.CUSTOM
      ? current.customLabel
      : null;
  return {
    label,
    customLabel: readCustomLabel(label, customLabel),
    address: record.address === undefined ? current.address : readRequiredText(record.address, 500, 'Enter the address'),
    latitude: record.latitude === undefined ? current.latitude : readCoordinate(record.latitude, 90),
    longitude: record.longitude === undefined ? current.longitude : readCoordinate(record.longitude, 180),
    ...readSource(
      record.placeId === undefined && record.coordinateSource === undefined ? current.placeId : record.placeId,
      record.coordinateSource === undefined && record.placeId === undefined ? current.coordinateSource : record.coordinateSource,
    ),
    contactName: record.contactName === undefined ? current.contactName : readPerson(record.contactName, current.contactName),
    contactPhone: record.contactPhone === undefined ? current.contactPhone : readPhone(record.contactPhone),
    isDefaultPickup: record.isDefaultPickup === undefined ? current.isDefaultPickup : readFlag(record.isDefaultPickup),
    reuseExisting: false,
  };
}

function recordOf(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Enter the address');
  }
  return body as Record<string, unknown>;
}

function readLabel(value: unknown): CustomerSavedAddressLabel {
  if (value === CustomerSavedAddressLabel.HOME || value === CustomerSavedAddressLabel.WORK || value === CustomerSavedAddressLabel.CUSTOM) {
    return value;
  }
  throw new BadRequestException('Choose Home, Work, or a custom label');
}

function readCustomLabel(label: CustomerSavedAddressLabel, value: unknown): string | null {
  if (label !== CustomerSavedAddressLabel.CUSTOM) {
    if (value === undefined || value === null || value === '') return null;
    throw new BadRequestException('Enter the address label');
  }
  return readRequiredText(value, 40, 'Enter the address label');
}

function readSource(placeId: unknown, source: unknown): { placeId: string | null; coordinateSource: CoordinateSource } {
  if (source !== CoordinateSource.GOOGLE_PLACES && source !== CoordinateSource.DEVICE_GEOCODER) {
    throw new BadRequestException('Enter a valid location');
  }
  const id = readPlace(placeId);
  if (source === CoordinateSource.GOOGLE_PLACES && !id) {
    throw new BadRequestException('Enter a valid location');
  }
  if (source === CoordinateSource.DEVICE_GEOCODER && id) {
    throw new BadRequestException('Enter a valid location');
  }
  return { placeId: id, coordinateSource: source };
}

function readPlace(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !isPlaceId(value.trim())) {
    throw new BadRequestException('Enter a valid location');
  }
  return value.trim();
}

function readCoordinate(value: unknown, limit: number): string {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric) || numeric < -limit || numeric > limit) {
    throw new BadRequestException('Enter a valid location');
  }
  return numeric.toFixed(7);
}

function readPerson(value: unknown, unchanged?: string): string {
  if (typeof value !== 'string') throw new BadRequestException('Enter the contact name');
  let name: string;
  try {
    name = normalizePersonName(value);
  } catch (error) {
    if (error instanceof InvalidPersonNameError) throw new BadRequestException('Enter the contact name');
    throw error;
  }
  if (unchanged !== undefined && unchanged === name) return name;
  if (!hasGivenNameAndSurname(name)) throw new BadRequestException('Enter your first name and surname.');
  return name;
}

function readPhone(value: unknown): string {
  if (typeof value !== 'string') throw new BadRequestException('Enter the contact phone');
  try {
    return normalizeAuthPhone(value);
  } catch (error) {
    if (error instanceof InvalidPhoneNumberError) throw new BadRequestException('Enter the contact phone');
    throw error;
  }
}

function readFlag(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return false;
  if (value === true) return true;
  throw new BadRequestException('Enter the address');
}

function readRequiredText(value: unknown, maxLength: number, message: string): string {
  if (typeof value !== 'string') throw new BadRequestException(message);
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text || text.length > maxLength || /[\u0000-\u001f]/.test(text)) {
    throw new BadRequestException(message);
  }
  return text;
}
