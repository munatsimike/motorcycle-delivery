import { BadRequestException } from '@nestjs/common';
import { CustomerAccountKind } from '../generated/prisma/client.js';
import { InvalidPersonNameError, normalizePersonName } from '../auth/person-name.js';

export type CustomerProfileInput = {
  kind: CustomerAccountKind;
  name: string;
  contactName: string | null;
  address: string;
  personName: string;
};

export function readCustomerProfile(body: unknown): CustomerProfileInput {
  if (typeof body !== 'object' || body === null) {
    throw new BadRequestException('Choose an individual or business account');
  }
  const record = body as Record<string, unknown>;
  const kind = readKind(record.accountKind);
  const address = readAddress(record.address);
  if (kind === CustomerAccountKind.BUSINESS) {
    const contactName = readPerson(record.contactName, 'Enter the contact name');
    const name = readPerson(record.businessName, 'Enter the business name');
    return { kind, name, contactName, address, personName: contactName };
  }
  const name = readPerson(record.fullName, 'Full name is required');
  return { kind, name, contactName: null, address, personName: name };
}

function readKind(value: unknown): CustomerAccountKind {
  if (value === CustomerAccountKind.INDIVIDUAL || value === 'INDIVIDUAL') {
    return CustomerAccountKind.INDIVIDUAL;
  }
  if (value === CustomerAccountKind.BUSINESS || value === 'BUSINESS') {
    return CustomerAccountKind.BUSINESS;
  }
  throw new BadRequestException('Choose an individual or business account');
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

export function readAddress(value: unknown): string {
  if (typeof value !== 'string') {
    throw new BadRequestException('Address is required');
  }
  const address = value.trim().replace(/\s+/g, ' ');
  if (address.length < 1 || address.length > 500 || /[\u0000-\u001f]/.test(address)) {
    throw new BadRequestException('Address is required');
  }
  return address;
}
