import { ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Prisma,
  ProfilePhotoStatus,
  RiderApprovalStatus,
  RiderAvailability,
  RiderVerificationStatus,
} from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { RiderContext } from '../auth/rider-access.service.js';
import { TooManyRequestsException } from '../auth/too-many-requests.exception.js';
import type { ObjectStorage } from './object-storage.js';
import { ProfilePhotoService } from './profile-photo.service.js';
import { DEFAULT_PROFILE_PHOTO_RETENTION_DAYS } from './profile-photo.constants.js';

const NOW = new Date('2026-10-29T09:00:00.000Z');
const RIDER: RiderContext = { userId: 'user-1', riderProfileId: 'profile-1' };
const OTHER: RiderContext = { userId: 'user-2', riderProfileId: 'profile-1' };

describe('ProfilePhotoService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.PROFILE_PHOTO_SUPERSEDED_RETENTION_DAYS;
  });

  it('stores a photo for a verified rider without changing approval or availability', async () => {
    const ctx = context();
    ctx.profiles[0] = verified(ctx.profiles[0]);
    const response = await ctx.service.upload(RIDER, await jpeg(), NOW);

    expect(response.contentType).toBe('image/jpeg');
    expect(response.uploadedAt).toBe(NOW.toISOString());
    expect(JSON.stringify(response)).not.toContain('profile-photos');
    expect(ctx.photos.filter((photo) => photo.status === ProfilePhotoStatus.STORED)).toHaveLength(1);
    expect(ctx.profiles[0]).toMatchObject({
      verificationStatus: RiderVerificationStatus.VERIFIED,
      approvalStatus: RiderApprovalStatus.APPROVED,
      availability: RiderAvailability.AVAILABLE,
    });
    const image = await ctx.service.image(RIDER);
    expect(image.contentType).toBe('image/jpeg');
    expect(image.bytes.length).toBe(response.byteSize);
  });

  it('rejects another rider reading or replacing the photo', async () => {
    const ctx = context();
    await expect(ctx.service.upload(OTHER, await jpeg(), NOW)).rejects.toBeInstanceOf(ForbiddenException);
    expect(ctx.storage.put).not.toHaveBeenCalled();
    await expect(ctx.service.image(OTHER)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctx.service.remove(OTHER, NOW)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps the current photo when the replacement commit fails', async () => {
    const ctx = context();
    ctx.photos.push(stored('photo-old'));
    ctx.failCommit = true;

    await expect(ctx.service.upload(RIDER, await jpeg(), NOW)).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(ctx.photos.find((photo) => photo.id === 'photo-old')?.status).toBe(ProfilePhotoStatus.STORED);
    expect(ctx.photos.some((photo) => photo.status === ProfilePhotoStatus.PURGE_PENDING)).toBe(true);
    expect(ctx.photos.filter((photo) => photo.status === ProfilePhotoStatus.STORED)).toHaveLength(1);
    const image = await ctx.service.image(RIDER);
    expect(image.bytes).toEqual(Buffer.from('old-photo'));
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
    const first = ctx.service.upload(RIDER, await jpeg(), NOW);
    await vi.waitFor(() => {
      expect(ctx.photos.some((photo) => photo.status === ProfilePhotoStatus.UPLOADING)).toBe(true);
    });

    await expect(ctx.service.upload(RIDER, await jpeg(), NOW)).rejects.toBeInstanceOf(ConflictException);
    release();
    await first;
    expect(ctx.photos.filter((photo) => photo.status === ProfilePhotoStatus.STORED)).toHaveLength(1);
  });

  it('hides a deleted photo immediately and is idempotent when none exists', async () => {
    const ctx = context();
    await ctx.service.remove(RIDER, NOW);
    expect(ctx.storage.delete).not.toHaveBeenCalled();

    ctx.photos.push(stored('photo-old'));
    await ctx.service.remove(RIDER, NOW);
    expect(ctx.photos.find((photo) => photo.id === 'photo-old')).toMatchObject({
      status: ProfilePhotoStatus.PURGE_PENDING,
      purgeAfter: NOW,
    });
    await expect(ctx.service.image(RIDER)).rejects.toBeInstanceOf(NotFoundException);
    await ctx.service.remove(RIDER, NOW);
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
    await expect(ctx.service.upload(RIDER, await jpeg(), NOW)).rejects.toBeInstanceOf(TooManyRequestsException);
    expect(ctx.photos.some((photo) => photo.status === ProfilePhotoStatus.UPLOADING)).toBe(false);
  });

  it('drops an in-flight upload when the photo is removed before it is stored', async () => {
    const ctx = context();
    ctx.photos.push(stored('photo-old'));
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    ctx.storage.put.mockImplementation(async () => {
      await gate;
    });
    const uploading = ctx.service.upload(RIDER, await jpeg(), NOW);
    await vi.waitFor(() => {
      expect(ctx.photos.some((photo) => photo.status === ProfilePhotoStatus.UPLOADING)).toBe(true);
    });

    await ctx.service.remove(RIDER, NOW);
    release();
    await expect(uploading).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.photos.find((photo) => photo.id === 'photo-old')?.status).toBe(ProfilePhotoStatus.PURGE_PENDING);
    expect(ctx.photos.filter((photo) => photo.status === ProfilePhotoStatus.STORED)).toHaveLength(0);
  });

  it('keeps the current photo when object storage rejects the replacement', async () => {
    const ctx = context();
    ctx.photos.push(stored('photo-old'));
    ctx.storage.put.mockRejectedValue(new Error('put failed'));

    await expect(ctx.service.upload(RIDER, await jpeg(), NOW)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(ctx.photos.find((photo) => photo.id === 'photo-old')?.status).toBe(ProfilePhotoStatus.STORED);
    expect(ctx.photos.some((photo) => photo.status === ProfilePhotoStatus.PURGE_PENDING)).toBe(true);
  });

  it('schedules the replaced photo for deletion only after the new photo is stored', async () => {
    const ctx = context();
    ctx.photos.push(stored('photo-old'));
    await ctx.service.upload(RIDER, await jpeg(), NOW);
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
  riderProfileId: string;
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

type Profile = {
  id: string;
  userId: string;
  verificationStatus: RiderVerificationStatus;
  approvalStatus: RiderApprovalStatus;
  availability: RiderAvailability;
};

function context() {
  const profiles: Profile[] = [{
    id: 'profile-1',
    userId: 'user-1',
    verificationStatus: RiderVerificationStatus.PENDING,
    approvalStatus: RiderApprovalStatus.PENDING,
    availability: RiderAvailability.OFFLINE,
  }];
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
    riderProfile: {
      async findUnique({ where }: { where: { id: string } }) {
        return profiles.find((profile) => profile.id === where.id) ?? null;
      },
    },
    riderProfilePhoto: photoDelegate(photos, operations, true),
  };

  const db = {
    riderProfile: {
      async findUnique({ where }: { where: { id: string } }) {
        return profiles.find((profile) => profile.id === where.id) ?? null;
      },
    },
    riderProfilePhoto: photoDelegate(photos, operations, false),
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
    service: new ProfilePhotoService(db as unknown as PrismaService, storage as unknown as ObjectStorage),
    profiles,
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
    async count({ where }: { where: { riderProfileId: string; uploadedAt: { gte: Date } } }) {
      return photos.filter((photo) => photo.riderProfileId === where.riderProfileId
        && photo.uploadedAt !== null
        && photo.uploadedAt >= where.uploadedAt.gte).length;
    },
    async create({ data }: { data: Photo }) {
      if (photos.some((photo) => photo.riderProfileId === data.riderProfileId && photo.status === ProfilePhotoStatus.UPLOADING)) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.1.0',
        });
      }
      photos.push({ ...data });
      return data;
    },
    async findFirst({ where }: { where: { riderProfileId: string; status: ProfilePhotoStatus } }) {
      return photos.find((photo) => photo.riderProfileId === where.riderProfileId && photo.status === where.status) ?? null;
    },
    async findUnique({ where }: { where: { id: string } }) {
      return photos.find((photo) => photo.id === where.id) ?? null;
    },
    async updateMany({ where, data }: {
      where: { id?: string; riderProfileId?: string; status: ProfilePhotoStatus | { in: ProfilePhotoStatus[] } };
      data: Partial<Photo>;
    }) {
      const statuses = typeof where.status === 'object' ? where.status.in : [where.status];
      let count = 0;
      for (const photo of photos) {
        const matches = (where.id === undefined || photo.id === where.id)
          && (where.riderProfileId === undefined || photo.riderProfileId === where.riderProfileId)
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
    riderProfileId: 'profile-1',
    objectKey: `riders/profile-1/profile-photos/${id}`,
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

function verified(profile: Profile): Profile {
  return {
    ...profile,
    verificationStatus: RiderVerificationStatus.VERIFIED,
    approvalStatus: RiderApprovalStatus.APPROVED,
    availability: RiderAvailability.AVAILABLE,
  };
}

function jpeg(): Promise<Buffer> {
  return sharp({
    create: { width: 16, height: 16, channels: 3, background: '#169B62' },
  }).jpeg().toBuffer();
}
