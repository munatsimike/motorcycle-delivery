import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomerSavedAddressLabel, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CustomerContext } from '../auth/customer-access.service.js';
import { readSavedAddress, readSavedAddressPatch, type SavedAddressInput } from './customer-saved-address.js';

export type SavedAddressResponse = {
  id: string;
  label: CustomerSavedAddressLabel;
  customLabel: string | null;
  address: string;
  latitude: string;
  longitude: string;
  placeId: string | null;
  coordinateSource: SavedAddressInput['coordinateSource'];
  contactName: string;
  contactPhone: string;
  isDefaultPickup: boolean;
  createdAt: string;
  updatedAt: string;
};

type AddressRow = {
  id: string;
  customerAccountId: string;
  label: CustomerSavedAddressLabel;
  customLabel: string | null;
  address: string;
  latitude: string | { toFixed(digits: number): string };
  longitude: string | { toFixed(digits: number): string };
  placeId: string | null;
  coordinateSource: SavedAddressInput['coordinateSource'];
  contactName: string;
  contactPhone: string;
  isDefaultPickup: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const HOME_INDEX = 'customer_saved_addresses_one_home_idx';
const WORK_INDEX = 'customer_saved_addresses_one_work_idx';
const DEFAULT_INDEX = 'customer_saved_addresses_one_default_pickup_idx';

@Injectable()
export class CustomerSavedAddressService {
  constructor(private readonly prisma: PrismaService) {}

  async list(customer: CustomerContext): Promise<SavedAddressResponse[]> {
    const rows = await this.prisma.customerSavedAddress.findMany({
      where: { customerAccountId: customer.customerAccountId },
      orderBy: [{ isDefaultPickup: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map(toResponse);
  }

  async create(customer: CustomerContext, body: unknown, now = new Date()): Promise<SavedAddressResponse> {
    const input = readSavedAddress(body);
    return this.save(customer.customerAccountId, null, input, now);
  }

  async update(customer: CustomerContext, id: string, body: unknown, now = new Date()): Promise<SavedAddressResponse> {
    const current = await this.owned(customer.customerAccountId, id);
    const input = readSavedAddressPatch(body, toInput(current));
    return this.save(customer.customerAccountId, id, input, now);
  }

  async remove(customer: CustomerContext, id: string): Promise<void> {
    const removed = await this.prisma.customerSavedAddress.deleteMany({
      where: { id, customerAccountId: customer.customerAccountId },
    });
    if (removed.count !== 1) {
      throw new NotFoundException('Saved address not found');
    }
  }

  private async save(
    customerAccountId: string,
    id: string | null,
    input: SavedAddressInput,
    now: Date,
  ): Promise<SavedAddressResponse> {
    try {
      return await this.write(customerAccountId, id, input, now);
    } catch (error) {
      if (!isDefaultConflict(error, input.isDefaultPickup)) throw error;
      try {
        return await this.write(customerAccountId, id, input, now);
      } catch (retryError) {
        if (isDefaultConflict(retryError, input.isDefaultPickup)) {
          throw new ConflictException('The default pickup was just changed. Try again.');
        }
        throw retryError;
      }
    }
  }

  private async write(
    customerAccountId: string,
    id: string | null,
    input: SavedAddressInput,
    now: Date,
  ): Promise<SavedAddressResponse> {
    let addressId = id;
    let next = input;
    try {
      const saved = await this.prisma.$transaction(async (tx) => {
        if (!addressId && next.reuseExisting) {
          const match = await this.matching(tx, customerAccountId, next);
          if (match) {
            if (!next.isDefaultPickup || match.isDefaultPickup) return match;
            addressId = match.id;
            next = { ...toInput(match), isDefaultPickup: true };
          }
        }
        if (next.isDefaultPickup) {
          await tx.customerSavedAddress.updateMany({
            where: {
              customerAccountId,
              isDefaultPickup: true,
              ...(addressId ? { NOT: { id: addressId } } : {}),
            },
            data: { isDefaultPickup: false, updatedAt: now },
          });
        }
        const data = {
          label: next.label,
          customLabel: next.customLabel,
          address: next.address,
          latitude: next.latitude,
          longitude: next.longitude,
          placeId: next.placeId,
          coordinateSource: next.coordinateSource,
          contactName: next.contactName,
          contactPhone: next.contactPhone,
          isDefaultPickup: next.isDefaultPickup,
          updatedAt: now,
        };
        if (!addressId) {
          return tx.customerSavedAddress.create({
            data: { ...data, customerAccountId, createdAt: now },
          });
        }
        const updated = await tx.customerSavedAddress.updateMany({
          where: { id: addressId, customerAccountId },
          data,
        });
        if (updated.count !== 1) {
          throw new NotFoundException('Saved address not found');
        }
        return tx.customerSavedAddress.findFirstOrThrow({ where: { id: addressId, customerAccountId } });
      });
      return toResponse(saved);
    } catch (error) {
      if (isDefaultConflict(error, next.isDefaultPickup)) throw error;
      const message = labelConflict(error, next.label);
      if (message) throw new ConflictException(message);
      throw error;
    }
  }

  private async owned(customerAccountId: string, id: string): Promise<AddressRow> {
    const row = await this.prisma.customerSavedAddress.findFirst({
      where: { id, customerAccountId },
    });
    if (!row) throw new NotFoundException('Saved address not found');
    return row;
  }

  private async matching(
    tx: Prisma.TransactionClient,
    customerAccountId: string,
    input: SavedAddressInput,
  ): Promise<AddressRow | null> {
    const rows = await tx.customerSavedAddress.findMany({ where: { customerAccountId } });
    return rows.find((row) => sameStop(row, input)) ?? null;
  }

}

function sameStop(row: AddressRow, input: SavedAddressInput): boolean {
  return row.address.trim().toLowerCase() === input.address.trim().toLowerCase()
    && coordinateText(row.latitude) === input.latitude
    && coordinateText(row.longitude) === input.longitude
    && row.contactPhone === input.contactPhone;
}

function toInput(row: AddressRow): SavedAddressInput {
  return {
    label: row.label,
    customLabel: row.customLabel,
    address: row.address,
    latitude: coordinateText(row.latitude),
    longitude: coordinateText(row.longitude),
    placeId: row.placeId,
    coordinateSource: row.coordinateSource,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    isDefaultPickup: row.isDefaultPickup,
    reuseExisting: false,
  };
}

function toResponse(row: AddressRow): SavedAddressResponse {
  return {
    id: row.id,
    label: row.label,
    customLabel: row.customLabel,
    address: row.address,
    latitude: coordinateText(row.latitude),
    longitude: coordinateText(row.longitude),
    placeId: row.placeId,
    coordinateSource: row.coordinateSource,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    isDefaultPickup: row.isDefaultPickup,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function coordinateText(value: string | { toFixed(digits: number): string }): string {
  return typeof value === 'string' ? Number(value).toFixed(7) : value.toFixed(7);
}

function labelConflict(error: unknown, label: CustomerSavedAddressLabel): string | null {
  const name = constraintText(error);
  if (name.includes(HOME_INDEX)) return 'You already have a Home address';
  if (name.includes(WORK_INDEX)) return 'You already have a Work address';
  if (!isUniqueViolation(name) || name.includes(DEFAULT_INDEX)) return null;
  if (label === CustomerSavedAddressLabel.HOME) return 'You already have a Home address';
  if (label === CustomerSavedAddressLabel.WORK) return 'You already have a Work address';
  return null;
}

function isDefaultConflict(error: unknown, settingDefault: boolean): boolean {
  const name = constraintText(error);
  if (name.includes(DEFAULT_INDEX)) return true;
  return settingDefault && isUniqueViolation(name) && !name.includes(HOME_INDEX) && !name.includes(WORK_INDEX);
}

function isUniqueViolation(text: string): boolean {
  return text.includes('P2002') || text.includes('23505');
}

function constraintText(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  const queue = [error];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    const record = current as Record<string, unknown>;
    for (const key of ['message', 'code', 'constraint', 'detail']) {
      if (typeof record[key] === 'string') parts.push(record[key]);
    }
    if (record.meta && typeof record.meta === 'object') parts.push(JSON.stringify(record.meta));
    queue.push(record.cause);
    const meta = record.meta;
    if (meta && typeof meta === 'object' && 'driverAdapterError' in meta) {
      queue.push((meta as { driverAdapterError?: unknown }).driverAdapterError);
    }
  }
  return parts.join(' ');
}
