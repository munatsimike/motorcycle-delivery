import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfilePhotoStatus } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ObjectStorage } from './object-storage.js';
import { ProfilePhotoCleanup } from './profile-photo.cleanup.js';

const NOW = new Date('2026-10-29T09:00:00.000Z');

describe('ProfilePhotoCleanup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('purges abandoned uploads and due photos, and retries a failed object delete', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const photos = [
      photo('abandoned', ProfilePhotoStatus.UPLOADING, new Date(NOW.getTime() - 2 * 60 * 60 * 1000), null),
      photo('fresh', ProfilePhotoStatus.UPLOADING, NOW, null),
      photo('deleted', ProfilePhotoStatus.PURGE_PENDING, NOW, NOW),
      photo('replaced', ProfilePhotoStatus.SUPERSEDED, new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000), new Date(NOW.getTime() - 1000)),
      photo('kept', ProfilePhotoStatus.SUPERSEDED, NOW, new Date(NOW.getTime() + 60 * 60 * 1000)),
      photo('current', ProfilePhotoStatus.STORED, NOW, null),
    ];
    const failures = new Set(['riders/profile-1/profile-photos/deleted']);
    const storage = {
      put: vi.fn(async () => undefined),
      get: vi.fn(async () => Buffer.from('photo')),
      delete: vi.fn(async (key: string) => {
        if (failures.has(key)) {
          failures.delete(key);
          throw Object.assign(new Error('delete failed'), { name: 'ServiceException' });
        }
      }),
    };
    const cleanup = new ProfilePhotoCleanup(database(photos, []) as unknown as PrismaService, storage as unknown as ObjectStorage, {} as never);

    await cleanup.run(NOW);
    expect(status(photos, 'abandoned')).toBe(ProfilePhotoStatus.PURGED);
    expect(status(photos, 'fresh')).toBe(ProfilePhotoStatus.UPLOADING);
    expect(status(photos, 'deleted')).toBe(ProfilePhotoStatus.PURGE_PENDING);
    expect(status(photos, 'replaced')).toBe(ProfilePhotoStatus.PURGED);
    expect(status(photos, 'kept')).toBe(ProfilePhotoStatus.SUPERSEDED);
    expect(status(photos, 'current')).toBe(ProfilePhotoStatus.STORED);
    expect(warn).toHaveBeenCalled();

    await cleanup.run(NOW);
    expect(status(photos, 'deleted')).toBe(ProfilePhotoStatus.PURGED);
    expect(photos.find((row) => row.id === 'deleted')?.purgedAt).toEqual(NOW);
    expect(status(photos, 'current')).toBe(ProfilePhotoStatus.STORED);
  });

  it('purges a superseded customer photo from the same private storage', async () => {
    const customerPhotos = [
      photo('customer-old', ProfilePhotoStatus.SUPERSEDED, NOW, new Date(NOW.getTime() - 1000)),
    ];
    customerPhotos[0]!.objectKey = 'customers/account-1/profile-photos/customer-old';
    const deleted: string[] = [];
    const storage = {
      put: vi.fn(async () => undefined),
      get: vi.fn(async () => Buffer.from('photo')),
      delete: vi.fn(async (key: string) => {
        deleted.push(key);
      }),
    };
    const cleanup = new ProfilePhotoCleanup(database([], customerPhotos) as unknown as PrismaService, storage as unknown as ObjectStorage, {} as never);

    await cleanup.run(NOW);

    expect(deleted).toEqual(['customers/account-1/profile-photos/customer-old']);
    expect(status(customerPhotos, 'customer-old')).toBe(ProfilePhotoStatus.PURGED);
  });
});

type Photo = {
  id: string;
  objectKey: string;
  status: ProfilePhotoStatus;
  createdAt: Date;
  purgeAfter: Date | null;
  purgedAt: Date | null;
};

function photo(id: string, status: ProfilePhotoStatus, createdAt: Date, purgeAfter: Date | null): Photo {
  return {
    id,
    objectKey: `riders/profile-1/profile-photos/${id}`,
    status,
    createdAt,
    purgeAfter,
    purgedAt: null,
  };
}

function status(photos: Photo[], id: string): ProfilePhotoStatus {
  return photos.find((row) => row.id === id)?.status ?? ProfilePhotoStatus.PURGED;
}

function database(photos: Photo[], customerPhotos: Photo[]) {
  return {
    riderProfilePhoto: photoTable(photos),
    customerProfilePhoto: photoTable(customerPhotos),
  };
}

function photoTable(photos: Photo[]) {
  return {
      async updateMany({ where, data }: { where: { id?: string; status?: ProfilePhotoStatus; createdAt?: { lt: Date } }; data: Partial<Photo> }) {
        for (const photo of photos) {
          const statusMatches = where.status === undefined || photo.status === where.status;
          const idMatches = where.id === undefined || photo.id === where.id;
          const oldEnough = where.createdAt === undefined || photo.createdAt < where.createdAt.lt;
          if (statusMatches && idMatches && oldEnough) {
            Object.assign(photo, data);
          }
        }
        return { count: 1 };
      },
      async findMany({ where }: { where: { OR: Array<{ status: ProfilePhotoStatus; purgeAfter?: { lte: Date } }> } }) {
        return photos.filter((photo) => where.OR.some((clause) => {
          if (photo.status !== clause.status) {
            return false;
          }
          if (clause.purgeAfter) {
            return photo.purgeAfter !== null && photo.purgeAfter <= clause.purgeAfter.lte;
          }
          return true;
        }));
      },
  };
}
