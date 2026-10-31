import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Prisma, ProfilePhotoStatus, UserRole } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { CustomerContext } from '../auth/customer-access.service.js';
import { TooManyRequestsException } from '../auth/too-many-requests.exception.js';
import { INCOMING_IMAGE_MAX_BYTES } from './licence.constants.js';
import type { ObjectStorage } from './object-storage.js';
import { CustomerAccountProfilePhotoService } from './customer-account-profile-photo.service.js';
import { DEFAULT_PROFILE_PHOTO_RETENTION_DAYS } from './profile-photo.constants.js';

const NOW = new Date('2026-10-30T09:00:00.000Z');
const CUSTOMER: CustomerContext = { userId: 'user-1', role: UserRole.CUSTOMER, customerAccountId: 'account-1' };
const OTHER: CustomerContext = { userId: 'user-2', role: UserRole.CUSTOMER, customerAccountId: 'account-1' };

describe('CustomerAccountProfilePhotoService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.PROFILE_PHOTO_SUPERSEDED_RETENTION_DAYS;
  });

  it('stores jpeg, png, and webp photos without a public url or object key', async () => {
    const ctx = context();
    const jpegResponse = await ctx.service.upload(CUSTOMER, await image('jpeg'), NOW);
    expect(jpegResponse.contentType).toBe('image/jpeg');
    expect(JSON.stringify(jpegResponse)).not.toContain('profile-photos');
    expect(JSON.stringify(jpegResponse)).not.toContain('objectKey');

    await ctx.service.remove(CUSTOMER, NOW);
    const pngResponse = await ctx.service.upload(CUSTOMER, await image('png'), NOW);
    expect(pngResponse.contentType).toBe('image/png');
    await ctx.service.remove(CUSTOMER, NOW);
    const webpResponse = await ctx.service.upload(CUSTOMER, await image('webp'), NOW);
    expect(webpResponse.contentType).toBe('image/webp');
    expect(ctx.photos.filter((photo) => photo.status === ProfilePhotoStatus.STORED)).toHaveLength(1);
    const downloaded = await ctx.service.image(CUSTOMER);
    expect(downloaded.contentType).toBe('image/webp');
    expect(downloaded.bytes.length).toBe(webpResponse.byteSize);
  });

  it('rejects an empty file, an oversized file, and a file that is not an image', async () => {
    const ctx = context();
    await expect(ctx.service.upload(CUSTOMER, Buffer.alloc(0), NOW)).rejects.toBeInstanceOf(PayloadTooLargeException);
    await expect(ctx.service.upload(CUSTOMER, Buffer.alloc(INCOMING_IMAGE_MAX_BYTES + 1), NOW)).rejects.toBeInstanceOf(PayloadTooLargeException);
    await expect(ctx.service.upload(CUSTOMER, Buffer.from('not-an-image'), NOW)).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    expect(ctx.photos.filter((photo) => photo.status === ProfilePhotoStatus.STORED)).toHaveLength(0);
    expect(ctx.photos.filter((photo) => photo.status === ProfilePhotoStatus.UPLOADING)).toHaveLength(0);
  });

  it('rejects another customer reading or replacing the photo', async () => {
    const ctx = context();
    await expect(ctx.service.upload(OTHER, await image('jpeg'), NOW)).rejects.toBeInstanceOf(ForbiddenException);
    expect(ctx.storage.put).not.toHaveBeenCalled();
    await expect(ctx.service.image(OTHER)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctx.service.remove(OTHER, NOW)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps the current photo when the replacement commit fails', async () => {
    const ctx = context();
    ctx.photos.push(stored('photo-old'));
    ctx.failCommit = true;

    await expect(ctx.service.upload(CUSTOMER, await image('jpeg'), NOW)).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(ctx.photos.find((photo) => photo.id === 'photo-old')?.status).toBe(ProfilePhotoStatus.STORED);
    expect(ctx.photos.filter((photo) => photo.status === ProfilePhotoStatus.STORED)).toHaveLength(1);
    const imageBytes = await ctx.service.image(CUSTOMER);
    expect(imageBytes.bytes).toEqual(Buffer.from('old-photo'));
  });

  it('rejects a second upload while the first is still uploading', async () => {
    const ctx = context();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    ctx.storage.put.mockImplementation(async () => {
      await gate;
    });
    const first = ctx.service.upload(CUSTOMER, await image('jpeg'), NOW);
    await vi.waitFor(() => {
      expect(ctx.photos.some((photo) => photo.status === ProfilePhotoStatus.UPLOADING)).toBe(true);
    });

    await expect(ctx.service.upload(CUSTOMER, await image('jpeg'), NOW)).rejects.toBeInstanceOf(ConflictException);
    release();
    await first;
    expect(ctx.photos.filter((photo) => photo.status === ProfilePhotoStatus.STORED)).toHaveLength(1);
  });

  it('hides a deleted photo immediately and is idempotent when none exists', async () => {
    const ctx = context();
    await ctx.service.remove(CUSTOMER, NOW);
    expect(ctx.storage.delete).not.toHaveBeenCalled();

    ctx.photos.push(stored('photo-old'));
    await ctx.service.remove(CUSTOMER, NOW);
    expect(ctx.photos.find((photo) => photo.id === 'photo-old')).toMatchObject({
      status: ProfilePhotoStatus.PURGE_PENDING,
      purgeAfter: NOW,
    });
    await expect(ctx.service.image(CUSTOMER)).rejects.toBeInstanceOf(NotFoundException);
    await ctx.service.remove(CUSTOMER, NOW);
    expect(ctx.photos.filter((photo) => photo.status === ProfilePhotoStatus.STORED)).toHaveLength(0);
  });

  it('limits uploads to ten an hour before creating another row', async () => {
    const ctx = context();
    for (let index = 0; index < 10; index += 1) {
      ctx.photos.push({
        ...stored(`photo-${index}`),
        status: ProfilePhotoStatus.SUPERSEDED,
        uploadedAt: NOW,
      });
    }
    await expect(ctx.service.upload(CUSTOMER, await image('jpeg'), NOW)).rejects.toBeInstanceOf(TooManyRequestsException);
    expect(ctx.photos.some((photo) => photo.status === ProfilePhotoStatus.UPLOADING)).toBe(false);
  });

  it('schedules the replaced photo for deletion only after the new photo is stored', async () => {
    const ctx = context();
    ctx.photos.push(stored('photo-old'));
    await ctx.service.upload(CUSTOMER, await image('jpeg'), NOW);
    expect(ctx.photos.find((photo) => photo.id === 'photo-old')).toMatchObject({
      status: ProfilePhotoStatus.SUPERSEDED,
      purgeAfter: new Date(NOW.getTime() + DEFAULT_PROFILE_PHOTO_RETENTION_DAYS * 24 * 60 * 60 * 1000),
    });
    expect(ctx.photos.filter((photo) => photo.status === ProfilePhotoStatus.STORED)).toHaveLength(1);
    expect(ctx.operations.indexOf(ProfilePhotoStatus.SUPERSEDED)).toBeLessThan(ctx.operations.indexOf('committed'));
  });
});

type Photo = {
  id: string;
  customerAccountId: string;
  objectKey: string;
  contentType: string | null;
  byteSize: number | null;
  sha256: string | null;
  status: ProfilePhotoStatus;
  uploadedAt: Date | null;
  supersededAt: Date | null;
  purgeAfter: Date | null;
  purgedAt: Date | null;
  createdAt: Date;
};

function context() {
  const accounts = [{ id: 'account-1', userId: 'user-1' }];
  const photos: Photo[] = [];
  const objects = new Map<string, Buffer>();
  const operations: string[] = [];
  const state = { failCommit: false };
  const storage = {
    put: vi.fn(async (key: string, body: Buffer) => {
      objects.set(key, Buffer.from(body));
    }),
    get: vi.fn(async (key: string) => {
      const body = objects.get(key);
      if (body) {
        return body;
      }
      if (key.endsWith('/photo-old')) {
        return Buffer.from('old-photo');
      }
      throw new Error('missing');
    }),
    delete: vi.fn(async () => undefined),
  };

  function clone(rows: Photo[]): Photo[] {
    return rows.map((photo) => ({
      ...photo,
      uploadedAt: photo.uploadedAt ? new Date(photo.uploadedAt) : null,
      supersededAt: photo.supersededAt ? new Date(photo.supersededAt) : null,
      purgeAfter: photo.purgeAfter ? new Date(photo.purgeAfter) : null,
      purgedAt: photo.purgedAt ? new Date(photo.purgedAt) : null,
      createdAt: new Date(photo.createdAt),
    }));
  }

  const tx = {
    $queryRaw: async () => [],
    customerProfilePhoto: photoDelegate(photos, operations, true),
  };

  const db = {
    customerAccount: {
      async findUnique({ where }: { where: { id: string } }) {
        return accounts.find((account) => account.id === where.id) ?? null;
      },
    },
    customerProfilePhoto: photoDelegate(photos, operations, false),
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => {
      const snapshot = clone(photos);
      try {
        const result = await run(tx);
        if (state.failCommit) {
          throw new Error('commit failed');
        }
        operations.push('committed');
        return result;
      } catch (error) {
        photos.splice(0, photos.length, ...snapshot);
        throw error;
      }
    },
  };

  return {
    service: new CustomerAccountProfilePhotoService(db as unknown as PrismaService, storage as unknown as ObjectStorage),
    photos,
    storage,
    operations,
    get failCommit() {
      return state.failCommit;
    },
    set failCommit(value: boolean) {
      state.failCommit = value;
    },
  };
}

function photoDelegate(photos: Photo[], operations: string[], transactional: boolean) {
  return {
    async count({ where }: { where: { customerAccountId: string; uploadedAt: { gte: Date } } }) {
      return photos.filter((photo) => photo.customerAccountId === where.customerAccountId
        && photo.uploadedAt !== null
        && photo.uploadedAt >= where.uploadedAt.gte).length;
    },
    async create({ data }: { data: Photo }) {
      if (photos.some((photo) => photo.customerAccountId === data.customerAccountId && photo.status === ProfilePhotoStatus.UPLOADING)) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.1.0',
        });
      }
      photos.push({ ...data });
      return data;
    },
    async findFirst({ where }: { where: { customerAccountId: string; status: ProfilePhotoStatus } }) {
      return photos.find((photo) => photo.customerAccountId === where.customerAccountId && photo.status === where.status) ?? null;
    },
    async findUnique({ where }: { where: { id: string } }) {
      return photos.find((photo) => photo.id === where.id) ?? null;
    },
    async updateMany({ where, data }: {
      where: { id?: string; customerAccountId?: string; status: ProfilePhotoStatus | { in: ProfilePhotoStatus[] } };
      data: Partial<Photo>;
    }) {
      const statuses = typeof where.status === 'object' ? where.status.in : [where.status];
      let count = 0;
      for (const photo of photos) {
        const matches = (where.id === undefined || photo.id === where.id)
          && (where.customerAccountId === undefined || photo.customerAccountId === where.customerAccountId)
          && statuses.includes(photo.status);
        if (!matches) {
          continue;
        }
        Object.assign(photo, data);
        count += 1;
        if (transactional) {
          operations.push(String(data.status));
        }
      }
      return { count };
    },
    async update({ where, data }: { where: { id: string }; data: Partial<Photo> }) {
      const photo = photos.find((row) => row.id === where.id);
      if (!photo) {
        throw new Error('missing photo');
      }
      Object.assign(photo, data);
      if (transactional) {
        operations.push(String(data.status));
      }
      return photo;
    },
  };
}

function stored(id: string): Photo {
  return {
    id,
    customerAccountId: 'account-1',
    objectKey: `customers/account-1/profile-photos/${id}`,
    contentType: 'image/jpeg',
    byteSize: Buffer.from('old-photo').length,
    sha256: 'a'.repeat(64),
    status: ProfilePhotoStatus.STORED,
    uploadedAt: new Date('2026-10-28T09:00:00.000Z'),
    supersededAt: null,
    purgeAfter: null,
    purgedAt: null,
    createdAt: new Date('2026-10-28T09:00:00.000Z'),
  };
}

function image(format: 'jpeg' | 'png' | 'webp'): Promise<Buffer> {
  const picture = sharp({
    create: { width: 16, height: 16, channels: 3, background: '#169B62' },
  });
  if (format === 'png') {
    return picture.png().toBuffer();
  }
  if (format === 'webp') {
    return picture.webp().toBuffer();
  }
  return picture.jpeg().toBuffer();
}
