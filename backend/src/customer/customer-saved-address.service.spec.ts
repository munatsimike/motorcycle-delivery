import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { Prisma, UserRole } from '../generated/prisma/client.js';
import { CustomerSavedAddressController } from './customer-saved-address.controller.js';
import { CustomerSavedAddressService } from './customer-saved-address.service.js';
import { readSavedAddress, readSavedAddressPatch } from './customer-saved-address.js';

const OWNER = { userId: 'user-1', role: UserRole.CUSTOMER, customerAccountId: 'account-1' };
const OTHER = { userId: 'user-2', role: UserRole.CUSTOMER, customerAccountId: 'account-2' };
const NOW = new Date('2026-11-17T00:00:00.000Z');

describe('customer saved addresses', () => {
  it('creates, lists, edits, and deletes only the signed-in customer rows', async () => {
    const db = memory();
    const service = new CustomerSavedAddressService(db.prisma);
    const created = await service.create(OWNER, addressBody(), NOW);
    await service.create(OTHER, addressBody({ customLabel: 'Other' }), NOW);
    expect(await service.list(OWNER)).toEqual([expect.objectContaining({ id: created.id, contactName: 'Tendai Moyo' })]);
    expect(await service.list(OTHER)).toHaveLength(1);
    const edited = await service.update(OWNER, created.id, { contactName: 'Rudo Ncube', contactPhone: '0770000000' }, NOW);
    expect(edited.contactName).toBe('Rudo Ncube');
    expect(edited.contactPhone).toBe('+263770000000');
    await expect(service.update(OTHER, created.id, { contactName: 'Thief' }, NOW)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(OTHER, created.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(db.deliveries).toEqual([{ id: 'delivery-1', recipientName: 'Historical' }]);
    await service.remove(OWNER, created.id);
    expect(await service.list(OWNER)).toEqual([]);
    expect(db.deliveries).toEqual([{ id: 'delivery-1', recipientName: 'Historical' }]);
  });

  it('allows many Home and Work addresses and edits a duplicate label', async () => {
    const service = new CustomerSavedAddressService(memory().prisma);
    const borrowdale = await service.create(OWNER, addressBody({ label: 'HOME', customLabel: null, address: 'Borrowdale' }), NOW);
    const avondale = await service.create(OWNER, addressBody({ label: 'HOME', customLabel: null, address: 'Avondale', contactName: 'Mary Ann Smith' }), NOW);
    const cbd = await service.create(OWNER, addressBody({ label: 'WORK', customLabel: null, address: 'Harare CBD' }), NOW);
    const workBorrowdale = await service.create(OWNER, addressBody({ label: 'WORK', customLabel: null, address: 'Borrowdale office' }), NOW);
    expect(new Set([borrowdale.id, avondale.id, cbd.id, workBorrowdale.id]).size).toBe(4);
    const edited = await service.update(OWNER, avondale.id, { label: 'HOME', address: 'Avondale West', contactPhone: '0770000000' }, NOW);
    expect(edited.id).toBe(avondale.id);
    expect(edited.label).toBe('HOME');
    expect(edited.address).toBe('Avondale West');
    expect((await service.list(OWNER)).filter((row) => row.label === 'HOME')).toHaveLength(2);
    expect((await service.list(OWNER)).filter((row) => row.label === 'WORK')).toHaveLength(2);
    expect((await service.list(OWNER)).find((row) => row.id === borrowdale.id)?.address).toBe('Borrowdale');
  });

  it('keeps a single default pickup and switches it atomically', async () => {
    const service = new CustomerSavedAddressService(memory().prisma);
    const first = await service.create(OWNER, addressBody({ isDefaultPickup: true }), NOW);
    const second = await service.create(OWNER, addressBody({ customLabel: 'Shop', address: 'Shop road', isDefaultPickup: true }), NOW);
    const rows = await service.list(OWNER);
    expect(rows.filter((row) => row.isDefaultPickup).map((row) => row.id)).toEqual([second.id]);
    expect(first.id).not.toBe(second.id);
    const cleared = await service.update(OWNER, second.id, { isDefaultPickup: false }, NOW);
    expect(cleared.isDefaultPickup).toBe(false);
    expect((await service.list(OWNER)).every((row) => row.isDefaultPickup === false)).toBe(true);
  });

  it('retries when two defaults are saved together', async () => {
    const db = memory({ collideOnce: true });
    const service = new CustomerSavedAddressService(db.prisma);
    const first = await service.create(OWNER, addressBody({ isDefaultPickup: true }), NOW);
    const second = await service.create(OWNER, addressBody({
      customLabel: 'Shop',
      address: 'Shop road',
      isDefaultPickup: true,
    }), NOW);
    expect((await service.list(OWNER)).filter((row) => row.isDefaultPickup).map((row) => row.id)).toEqual([second.id]);
    expect(db.defaultCollisions).toBe(1);
    expect(first.isDefaultPickup).toBe(true);
  });

  it('retries a default unique violation reported by Prisma without the index name at the top', async () => {
    const db = memory({ collideOnce: true, opaqueDefault: true });
    const service = new CustomerSavedAddressService(db.prisma);
    await service.create(OWNER, addressBody({ isDefaultPickup: true }), NOW);
    const second = await service.create(OWNER, addressBody({
      customLabel: 'Shop',
      address: 'Shop road',
      isDefaultPickup: true,
    }), NOW);
    expect((await service.list(OWNER)).filter((row) => row.isDefaultPickup).map((row) => row.id)).toEqual([second.id]);
  });

  it('returns the existing stop when booking save is repeated', async () => {
    const service = new CustomerSavedAddressService(memory().prisma);
    const first = await service.create(OWNER, addressBody({ reuseExisting: true }), NOW);
    const second = await service.create(OWNER, addressBody({ customLabel: 'Again', reuseExisting: true }), NOW);
    expect(second.id).toBe(first.id);
    expect(await service.list(OWNER)).toHaveLength(1);
  });

  it('rejects coordinates and contact details that cannot be stored', async () => {
    const service = new CustomerSavedAddressService(memory().prisma);
    await expect(service.create(OWNER, addressBody({ latitude: '91' }), NOW)).rejects.toThrow('Enter a valid location');
    await expect(service.create(OWNER, addressBody({ longitude: '-181' }), NOW)).rejects.toThrow('Enter a valid location');
    await expect(service.create(OWNER, addressBody({ contactPhone: '123' }), NOW)).rejects.toThrow('Enter the contact phone');
    await expect(service.create(OWNER, addressBody({ contactName: ' ' }), NOW)).rejects.toThrow('Enter the contact name');
    await expect(service.create(OWNER, addressBody({ contactName: 'Tendai' }), NOW)).rejects.toThrow('Enter your first name and surname.');
    const created = await service.create(OWNER, addressBody({ contactName: "Mary-Ann O'Connor" }), NOW);
    expect(created.contactName).toBe("Mary-Ann O'Connor");
    const stored = readSavedAddress(addressBody({ contactName: 'Rudo Ncube' }));
    stored.contactName = 'Rudo';
    expect(readSavedAddressPatch({ contactName: '  Rudo  ' }, stored).contactName).toBe('Rudo');
    await expect(service.update(OWNER, created.id, { contactName: 'Rudo' }, NOW)).rejects.toThrow('Enter your first name and surname.');
    await expect(service.create(OWNER, addressBody({ label: 'HOME', customLabel: 'House' }), NOW)).rejects.toThrow('Enter the address label');
    await expect(service.create(OWNER, addressBody({ coordinateSource: 'GOOGLE_PLACES', placeId: null }), NOW)).rejects.toThrow('Enter a valid location');
  });

  it('requires the signed-in customer', () => {
    const controller = new CustomerSavedAddressController({} as never);
    expect(() => controller.list({})).toThrow(ForbiddenException);
    expect(() => controller.create({}, {})).toThrow(ForbiddenException);
    expect(() => controller.update({}, '018f5b4a-7c3a-7c3a-8c3a-7c3a7c3a7c3a', {})).toThrow(ForbiddenException);
    expect(() => controller.remove({}, '018f5b4a-7c3a-7c3a-8c3a-7c3a7c3a7c3a')).toThrow(ForbiddenException);
  });
});

function addressBody(overrides: Record<string, unknown> = {}) {
  return {
    label: 'CUSTOM',
    customLabel: 'Home office',
    address: '12 Samora Machel Avenue',
    latitude: '-17.8292000',
    longitude: '31.0522000',
    placeId: null,
    coordinateSource: 'DEVICE_GEOCODER',
    contactName: 'Tendai Moyo',
    contactPhone: '0771234567',
    isDefaultPickup: false,
    reuseExisting: false,
    ...overrides,
  };
}

type Row = {
  id: string;
  customerAccountId: string;
  label: 'HOME' | 'WORK' | 'CUSTOM';
  customLabel: string | null;
  address: string;
  latitude: string;
  longitude: string;
  placeId: string | null;
  coordinateSource: 'GOOGLE_PLACES' | 'DEVICE_GEOCODER';
  contactName: string;
  contactPhone: string;
  isDefaultPickup: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function memory(options?: { collideOnce?: boolean; opaqueDefault?: boolean }) {
  const rows: Row[] = [];
  const deliveries = [{ id: 'delivery-1', recipientName: 'Historical' }];
  let sequence = 0;
  let defaultCollisions = 0;
  let skipClear = options?.collideOnce === true;
  const prisma = {
    customerSavedAddress: {
      async findMany({ where }: { where: { customerAccountId: string } }) {
        return rows.filter((row) => row.customerAccountId === where.customerAccountId)
          .sort((left, right) => Number(right.isDefaultPickup) - Number(left.isDefaultPickup) || left.createdAt.getTime() - right.createdAt.getTime());
      },
      async findFirst({ where }: { where: { id?: string; customerAccountId: string; label?: Row['label']; NOT?: { id: string } } }) {
        return rows.find((row) => matches(row, where)) ?? null;
      },
      async findFirstOrThrow({ where }: { where: { id: string; customerAccountId: string } }) {
        const row = rows.find((item) => item.id === where.id && item.customerAccountId === where.customerAccountId);
        if (!row) throw new Error('missing address');
        return row;
      },
      async create({ data }: { data: Omit<Row, 'id'> }) {
        assertIndexes(null, data);
        const row = { ...data, id: `018f5b4a-7c3a-7c3a-8c3a-${String(++sequence).padStart(12, '0')}` };
        rows.push(row);
        return row;
      },
      async updateMany({ where, data }: { where: { id?: string; customerAccountId: string; isDefaultPickup?: boolean; NOT?: { id: string } }; data: Partial<Row> }) {
        if (skipClear && where.isDefaultPickup === true && !where.id) {
          skipClear = false;
          defaultCollisions += 1;
          return { count: 0 };
        }
        let count = 0;
        for (const row of rows) {
          if (!matches(row, where)) continue;
          Object.assign(row, data);
          count += 1;
        }
        if (where.id && data.isDefaultPickup === true) assertIndexes(where.id, rows.find((row) => row.id === where.id)!);
        return { count };
      },
      async deleteMany({ where }: { where: { id: string; customerAccountId: string } }) {
        const before = rows.length;
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          if (rows[index]?.id === where.id && rows[index]?.customerAccountId === where.customerAccountId) rows.splice(index, 1);
        }
        return { count: before - rows.length };
      },
    },
    $transaction(work: (tx: typeof prisma) => Promise<Row>) {
      return work(prisma);
    },
  };
  return {
    prisma: prisma as never,
    deliveries,
    get defaultCollisions() {
      return defaultCollisions;
    },
  };

  function assertIndexes(id: string | null, data: { customerAccountId: string; label: Row['label']; isDefaultPickup: boolean }) {
    const others = rows.filter((row) => row.customerAccountId === data.customerAccountId && row.id !== id);
    if (data.isDefaultPickup && others.some((row) => row.isDefaultPickup)) {
      if (options?.opaqueDefault) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`customer_account_id`)', {
          code: 'P2002',
          clientVersion: '7.1.0',
          meta: {
            driverAdapterError: {
              cause: {
                code: '23505',
                message: 'duplicate key value violates unique constraint "customer_saved_addresses_one_default_pickup_idx"',
              },
            },
          },
        });
      }
      throw new Error('customer_saved_addresses_one_default_pickup_idx');
    }
  }
}

function matches(row: Row, where: { id?: string; customerAccountId: string; label?: Row['label']; isDefaultPickup?: boolean; NOT?: { id: string } }): boolean {
  if (row.customerAccountId !== where.customerAccountId) return false;
  if (where.id && row.id !== where.id) return false;
  if (where.label && row.label !== where.label) return false;
  if (where.isDefaultPickup !== undefined && row.isDefaultPickup !== where.isDefaultPickup) return false;
  if (where.NOT && row.id === where.NOT.id) return false;
  return true;
}
