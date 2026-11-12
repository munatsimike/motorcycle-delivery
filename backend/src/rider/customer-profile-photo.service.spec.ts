import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AssignmentStatus, BidStatus, ProfilePhotoStatus, UserRole } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { CustomerContext } from '../auth/customer-access.service.js';
import type { ObjectStorage } from './object-storage.js';
import { CustomerProfilePhotoService } from './customer-profile-photo.service.js';

const CUSTOMER: CustomerContext = { userId: 'user-1', role: UserRole.CUSTOMER, customerAccountId: 'customer-1' };
const DELIVERY = '00000000-0000-4000-8000-000000000001';
const BID = '00000000-0000-4000-8000-000000000002';

describe('CustomerProfilePhotoService', () => {
  it('returns a bidding rider photo only for the owning customer', async () => {
    const ctx = context();
    const image = await ctx.service.bidImage(CUSTOMER, DELIVERY, BID);
    expect(image).toEqual({ bytes: Buffer.from('photo'), contentType: 'image/jpeg' });
    expect(JSON.stringify(image)).not.toContain('profile-photos');

    await expect(ctx.service.bidImage({ ...CUSTOMER, customerAccountId: 'other' }, DELIVERY, BID))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(ctx.service.bidImage(CUSTOMER, DELIVERY, '00000000-0000-4000-8000-000000000099'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(ctx.storage.get).toHaveBeenCalledTimes(1);
  });

  it('returns the assigned rider photo and hides a rider with no stored photo', async () => {
    const ctx = context();
    ctx.photos[0]!.status = ProfilePhotoStatus.PURGE_PENDING;
    await expect(ctx.service.assignedImage(CUSTOMER, DELIVERY)).rejects.toBeInstanceOf(NotFoundException);

    ctx.photos[0]!.status = ProfilePhotoStatus.STORED;
    await expect(ctx.service.assignedImage(CUSTOMER, DELIVERY)).resolves.toMatchObject({ contentType: 'image/jpeg' });
    await expect(ctx.service.assignedImage(CUSTOMER, '00000000-0000-4000-8000-000000000099'))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});

function context() {
  const photos: Array<{
    riderProfileId: string;
    objectKey: string;
    contentType: string;
    status: ProfilePhotoStatus;
  }> = [{
    riderProfileId: 'profile-1',
    objectKey: 'riders/profile-1/profile-photos/photo-1',
    contentType: 'image/jpeg',
    status: ProfilePhotoStatus.STORED,
  }];
  const storage = {
    put: vi.fn(async () => undefined),
    get: vi.fn(async () => Buffer.from('photo')),
    delete: vi.fn(async () => undefined),
  };
  const db = {
    delivery: {
      async findFirst({ where }: { where: { id: string; customerId: string } }) {
        return where.id === DELIVERY && where.customerId === 'customer-1' ? { id: DELIVERY } : null;
      },
    },
    bid: {
      async findFirst({ where }: { where: { id: string; deliveryId: string; status: BidStatus } }) {
        if (where.id === BID && where.deliveryId === DELIVERY && where.status === BidStatus.OPEN) {
          return { riderProfileId: 'profile-1' };
        }
        return null;
      },
    },
    deliveryAssignment: {
      async findFirst({ where }: { where: { deliveryId: string; status: { in: AssignmentStatus[] } } }) {
        if (where.deliveryId === DELIVERY && where.status.in.includes(AssignmentStatus.ACCEPTED)) {
          return { riderProfileId: 'profile-1' };
        }
        return null;
      },
    },
    riderProfilePhoto: {
      async findFirst({ where }: { where: { riderProfileId: string; status: ProfilePhotoStatus } }) {
        return photos.find((photo) => photo.riderProfileId === where.riderProfileId && photo.status === where.status) ?? null;
      },
    },
  };
  return {
    service: new CustomerProfilePhotoService(db as unknown as PrismaService, storage as unknown as ObjectStorage),
    photos,
    storage,
  };
}
