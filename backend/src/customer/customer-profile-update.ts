import { BadRequestException } from '@nestjs/common';
import { InvalidPersonNameError, normalizePersonName } from '../auth/person-name.js';
import { readAddress } from './customer-profile.js';

export type CustomerProfileUpdate = {
  fullName: string;
  email: string | null;
  address: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function readCustomerProfileUpdate(body: unknown): CustomerProfileUpdate {
  if (typeof body !== 'object' || body === null) {
    throw new BadRequestException('Full name is required');
  }
  const record = body as Record<string, unknown>;
  return {
    fullName: readFullName(record.fullName),
    email: readEmail(record.email),
    address: readAddress(record.address),
  };
}

function readFullName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new BadRequestException('Full name is required');
  }
  try {
    return normalizePersonName(value);
  } catch (error) {
    if (error instanceof InvalidPersonNameError) {
      throw new BadRequestException('Full name is required');
    }
    throw error;
  }
}

function readEmail(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new BadRequestException('Enter a valid email address.');
  }
  const email = value.trim().toLowerCase();
  if (!email) {
    return null;
  }
  if (email.length > 254 || !EMAIL_PATTERN.test(email) || /[\u0000-\u001f]/.test(email)) {
    throw new BadRequestException('Enter a valid email address.');
  }
  return email;
}
