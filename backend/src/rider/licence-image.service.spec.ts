import { createHash } from 'node:crypto';
import { ConflictException, ForbiddenException, Logger, NotFoundException, PayloadTooLargeException, ServiceUnavailableException, UnsupportedMediaTypeException } from '@nestjs/common';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LicenceImageReviewStatus,
  LicenceImageStatus,
  Prisma,
  RiderApprovalStatus,
  RiderAvailability,
  RiderVerificationStatus,
} from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { RiderContext } from '../auth/rider-access.service.js';
import { TooManyRequestsException } from '../auth/too-many-requests.exception.js';
import { LicenceImageService } from './licence-image.service.js';
import { INCOMING_IMAGE_MAX_BYTES } from './licence.constants.js';
import type { ObjectStorage } from './object-storage.js';

const NOW = new Date('2026-10-13T12:00:00.000Z');
const RIDER: RiderContext = { userId: 'user-1', riderProfileId: 'profile-1' };

describe('LicenceImageService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LICENCE_STORAGE_MAX_BYTES;
    delete process.env.LICENCE_STORAGE_SECRET_ACCESS_KEY;
    delete process.env.LICENCE_SUPERSEDED_RETENTION_DAYS;
  });

  it('stores a sanitized image and leaves a new rider pending and offline', async () => {
    const ctx = context();
    const comment = 'GPS-LATITUDE-SECRET';
    const input = withJpegComment(await jpeg(), comment);
    const response = await ctx.service.upload(RIDER, input, NOW);

    expect(response.reviewStatus).toBe(LicenceImageReviewStatus.PENDING);
    expect(response.contentType).toBe('image/jpeg');
    expect(response.uploadedAt).toBe(NOW.toISOString());
    expect(ctx.stored[0].length).toBe(response.byteSize);
    expect(ctx.images[0]).toMatchObject({
      status: LicenceImageStatus.STORED,
      sha256: createHash('sha256').update(ctx.storedBody()).digest('hex'),
    });
    expect(ctx.storedBody().includes(Buffer.from(comment))).toBe(false);
    expect(ctx.profile()).toMatchObject({
      verificationStatus: RiderVerificationStatus.PENDING,
      approvalStatus: RiderApprovalStatus.PENDING,
      availability: RiderAvailability.OFFLINE,
      licenceNumber: null,
      licenceClass: null,
      verifiedAt: null,
      reviewerId: null,
    });
    expect(JSON.stringify(response)).not.toContain(ctx.images[0].objectKey);
    expect(await ctx.service.current(RIDER)).toEqual(response);
  });

  it('rejects a non-image and an image whose sanitized output exceeds the storage limit', async () => {
    const invalid = context();
    await expect(invalid.service.upload(RIDER, Buffer.from('<html></html>'), NOW)).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    expect(invalid.storage.put).not.toHaveBeenCalled();
    expect(invalid.images).toHaveLength(0);

    process.env.LICENCE_STORAGE_MAX_BYTES = '1';
    const oversized = context();
    await expect(oversized.service.upload(RIDER, await jpeg(), NOW)).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(oversized.storage.put).not.toHaveBeenCalled();
    expect(oversized.images).toHaveLength(0);

    const incoming = context();
    await expect(incoming.service.upload(RIDER, Buffer.alloc(INCOMING_IMAGE_MAX_BYTES + 1), NOW)).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(incoming.storage.put).not.toHaveBeenCalled();
  });

  it('rejects replacement of a verified licence without changing approval or the stored document', async () => {
    const ctx = context();
    ctx.profiles[0] = {
      ...ctx.profiles[0],
      verificationStatus: RiderVerificationStatus.VERIFIED,
      approvalStatus: RiderApprovalStatus.APPROVED,
      licenceNumber: 'ZW-100',
      licenceClass: '4',
      verifiedAt: NOW,
      reviewerId: 'admin-1',
    };
    ctx.images.push(storedImage('image-verified'));

    await expect(ctx.service.upload(RIDER, await jpeg(), NOW)).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.storage.put).not.toHaveBeenCalled();
    expect(ctx.images).toEqual([expect.objectContaining({ id: 'image-verified', status: LicenceImageStatus.STORED })]);
    expect(ctx.profile()).toMatchObject({
      verificationStatus: RiderVerificationStatus.VERIFIED,
      approvalStatus: RiderApprovalStatus.APPROVED,
      availability: RiderAvailability.OFFLINE,
      licenceNumber: 'ZW-100',
      licenceClass: '4',
      reviewerId: 'admin-1',
    });
  });

  it('supersedes the previous image before storing a resubmission and clears a rejection', async () => {
    const ctx = context();
    ctx.profiles[0] = {
      ...ctx.profiles[0],
      verificationStatus: RiderVerificationStatus.REJECTED,
      reviewerId: 'admin-1',
    };
    ctx.images.push(storedImage('image-old'));

    await ctx.service.upload(RIDER, await jpeg(), NOW);

    expect(ctx.operations.indexOf(LicenceImageStatus.SUPERSEDED)).toBeLessThan(ctx.operations.indexOf(LicenceImageStatus.STORED));
    expect(ctx.images.find((image) => image.id === 'image-old')).toMatchObject({
      status: LicenceImageStatus.SUPERSEDED,
      purgeAfter: new Date(NOW.getTime() + 90 * 24 * 60 * 60 * 1000),
    });
    expect(ctx.images.filter((image) => image.status === LicenceImageStatus.STORED)).toHaveLength(1);
    expect(ctx.profile()).toMatchObject({
      verificationStatus: RiderVerificationStatus.PENDING,
      approvalStatus: RiderApprovalStatus.PENDING,
      availability: RiderAvailability.OFFLINE,
      reviewerId: null,
      licenceNumber: null,
    });
    expect(ctx.locks).toEqual(['profile', 'images']);
    expect(ctx.reviews).toEqual([expect.objectContaining({ id: 'review-1', decision: 'REJECT' })]);
    expect(ctx.reviewMutations).toEqual([]);
  });

  it('rolls back when the stored update fails and leaves the original image in place', async () => {
    const ctx = context();
    ctx.images.push(storedImage('image-old'));
    ctx.failStore = true;

    await expect(ctx.service.upload(RIDER, await jpeg(), NOW)).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(ctx.operations.indexOf(LicenceImageStatus.SUPERSEDED)).toBeLessThan(ctx.operations.indexOf(LicenceImageStatus.STORED));
    expect(ctx.images.find((image) => image.id === 'image-old')?.status).toBe(LicenceImageStatus.STORED);
    expect(ctx.images.filter((image) => image.status === LicenceImageStatus.STORED)).toHaveLength(1);
    expect(ctx.images.some((image) => image.status === LicenceImageStatus.UPLOADING)).toBe(true);
    expect(ctx.images.some((image) => image.status === LicenceImageStatus.PURGED)).toBe(false);
  });

  it('keeps a failed object delete pending instead of marking it purged', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    process.env.LICENCE_STORAGE_SECRET_ACCESS_KEY = 'storage-secret-value';
    const ctx = context();
    ctx.storage.put.mockRejectedValue(Object.assign(new Error('write failed storage-secret-value +263771234567'), {
      name: 'NetworkingError',
      $metadata: { httpStatusCode: 500 },
    }));

    await expect(ctx.service.upload(RIDER, await jpeg(), NOW)).rejects.toBeInstanceOf(ServiceUnavailableException);

    const failed = ctx.images[0];
    expect(failed.status).toBe(LicenceImageStatus.PURGE_PENDING);
    expect(failed.purgedAt).toBeNull();
    const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('httpStatus=500');
    expect(logged).toContain('error=NetworkingError');
    expect(logged).toContain('detail=write failed [redacted] [phone]');
    expect(logged).not.toContain('storage-secret-value');
    expect(logged).not.toContain('+263771234567');
    expect(logged).not.toContain(failed.objectKey);
  });

  it('does not upload for another rider profile or beyond the hourly limit', async () => {
    const foreign = context();
    await expect(foreign.service.upload({ userId: 'user-2', riderProfileId: 'profile-1' }, await jpeg(), NOW))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(foreign.storage.put).not.toHaveBeenCalled();

    const limited = context();
    for (let index = 0; index < 5; index += 1) {
      limited.images.push({ ...storedImage(`image-${index}`), uploadedAt: NOW });
    }
    await expect(limited.service.upload(RIDER, await jpeg(), NOW)).rejects.toBeInstanceOf(TooManyRequestsException);
    expect(limited.storage.put).not.toHaveBeenCalled();

    const empty = context();
    await expect(empty.service.current(RIDER)).rejects.toBeInstanceOf(NotFoundException);
  });
});

type ProfileRow = {
  id: string;
  userId: string;
  verificationStatus: RiderVerificationStatus;
  approvalStatus: RiderApprovalStatus;
  availability: RiderAvailability;
  licenceNumber: string | null;
  licenceClass: string | null;
  verifiedAt: Date | null;
  reviewerId: string | null;
};

type ImageRow = {
  id: string;
  riderProfileId: string;
  objectKey: string;
  contentType: string | null;
  byteSize: number | null;
  sha256: string | null;
  status: LicenceImageStatus;
  reviewStatus: LicenceImageReviewStatus;
  uploadedAt: Date | null;
  supersededAt: Date | null;
  purgeAfter: Date | null;
  purgedAt: Date | null;
  createdAt: Date;
};

function context() {
  const profiles: ProfileRow[] = [{
    id: 'profile-1',
    userId: 'user-1',
    verificationStatus: RiderVerificationStatus.PENDING,
    approvalStatus: RiderApprovalStatus.PENDING,
    availability: RiderAvailability.OFFLINE,
    licenceNumber: null,
    licenceClass: null,
    verifiedAt: null,
    reviewerId: null,
  }];
  const images: ImageRow[] = [];
  const operations: string[] = [];
  const locks: string[] = [];
  const reviews = [{ id: 'review-1', riderProfileId: 'profile-1', decision: 'REJECT' }];
  const reviewMutations: string[] = [];
  const stored: Buffer[] = [];
  const state = { failStore: false };
  const matches = (row: ImageRow, where: Record<string, unknown>): boolean => {
    if (typeof where.id === 'string' && row.id !== where.id) return false;
    if (typeof where.riderProfileId === 'string' && row.riderProfileId !== where.riderProfileId) return false;
    if (typeof where.status === 'string' && row.status !== where.status) return false;
    const uploadedAt = where.uploadedAt as { gte?: Date } | undefined;
    if (uploadedAt?.gte && (!row.uploadedAt || row.uploadedAt < uploadedAt.gte)) return false;
    return true;
  };
  const apply = (row: ImageRow, data: Partial<ImageRow>) => {
    if (data.status) {
      operations.push(data.status);
    }
    if (data.status === LicenceImageStatus.STORED && state.failStore) {
      throw new Error('store write failed');
    }
    if (data.status === LicenceImageStatus.STORED && images.some((image) => image.id !== row.id && image.riderProfileId === row.riderProfileId && image.status === LicenceImageStatus.STORED)) {
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '7.1.0' });
    }
    Object.assign(row, data);
  };
  const imagesApi = {
    async count({ where }: { where: Record<string, unknown> }) {
      return images.filter((row) => matches(row, where)).length;
    },
    async findFirst({ where }: { where: Record<string, unknown> }) {
      return images.find((row) => matches(row, where)) ?? null;
    },
    async create({ data }: { data: ImageRow }) {
      if (images.some((row) => row.riderProfileId === data.riderProfileId && row.status === LicenceImageStatus.UPLOADING)) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '7.1.0' });
      }
      const row: ImageRow = {
        ...data,
        contentType: data.contentType ?? null,
        byteSize: data.byteSize ?? null,
        sha256: data.sha256 ?? null,
        uploadedAt: data.uploadedAt ?? null,
        supersededAt: data.supersededAt ?? null,
        purgeAfter: data.purgeAfter ?? null,
        purgedAt: data.purgedAt ?? null,
      };
      images.push(row);
      return row;
    },
    async delete({ where }: { where: { id: string } }) {
      const index = images.findIndex((row) => row.id === where.id);
      if (index >= 0) {
        images.splice(index, 1);
      }
    },
    async update({ where, data }: { where: { id: string }; data: Partial<ImageRow> }) {
      const row = images.find((image) => image.id === where.id);
      if (!row) {
        throw new Error('image missing');
      }
      apply(row, data);
      return row;
    },
    async updateMany({ where, data }: { where: Record<string, unknown>; data: Partial<ImageRow> }) {
      const matched = images.filter((row) => matches(row, where));
      for (const row of matched) {
        apply(row, data);
      }
      return { count: matched.length };
    },
  };
  const profilesApi = {
    async findUnique({ where }: { where: { id: string } }) {
      return profiles.find((profile) => profile.id === where.id) ?? null;
    },
    async updateMany({ where, data }: { where: { id: string; verificationStatus?: RiderVerificationStatus }; data: Partial<ProfileRow> }) {
      const matched = profiles.filter((profile) => profile.id === where.id && (!where.verificationStatus || profile.verificationStatus === where.verificationStatus));
      for (const profile of matched) {
        Object.assign(profile, data);
      }
      return { count: matched.length };
    },
  };
  const db = {
    riderProfile: profilesApi,
    riderLicenceImage: imagesApi,
    riderLicenceReview: {
      async create() {
        reviewMutations.push('create');
        throw new Error('reviews are not written by upload');
      },
      async update() {
        reviewMutations.push('update');
        throw new Error('rider licence reviews are append-only');
      },
      async delete() {
        reviewMutations.push('delete');
        throw new Error('rider licence reviews are append-only');
      },
    },
    async $queryRaw(strings: TemplateStringsArray) {
      const sql = strings.join(' ');
      if (sql.includes('rider_profiles') && sql.includes('FOR UPDATE')) {
        locks.push('profile');
      }
      if (sql.includes('rider_licence_images') && sql.includes('FOR UPDATE')) {
        locks.push('images');
      }
      return [];
    },
    async $transaction<T>(callback: (tx: object) => Promise<T>) {
      const imageSnapshot = structuredClone(images);
      const profileSnapshot = structuredClone(profiles);
      try {
        return await callback(db);
      } catch (error) {
        images.splice(0, images.length, ...imageSnapshot);
        profiles.splice(0, profiles.length, ...profileSnapshot);
        throw error;
      }
    },
  };
  const storage = {
    put: vi.fn(async (_key: string, body: Buffer) => {
      stored.push(body);
    }),
    delete: vi.fn(async () => undefined),
  };
  return {
    service: new LicenceImageService(db as unknown as PrismaService, storage as unknown as ObjectStorage),
    storage,
    images,
    profiles,
    operations,
    locks,
    reviews,
    reviewMutations,
    stored,
    storedBody: () => stored[0] ?? Buffer.alloc(0),
    profile: () => profiles[0],
    get failStore() {
      return state.failStore;
    },
    set failStore(value: boolean) {
      state.failStore = value;
    },
  };
}

function storedImage(id: string): ImageRow {
  return {
    id,
    riderProfileId: 'profile-1',
    objectKey: `riders/profile-1/licences/${id}`,
    contentType: 'image/jpeg',
    byteSize: 10,
    sha256: 'a'.repeat(64),
    status: LicenceImageStatus.STORED,
    reviewStatus: LicenceImageReviewStatus.PENDING,
    uploadedAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
    supersededAt: null,
    purgeAfter: null,
    purgedAt: null,
    createdAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
  };
}

function jpeg(): Promise<Buffer> {
  return sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 20, g: 40, b: 60 } },
  }).jpeg().toBuffer();
}

function withJpegComment(input: Buffer, comment: string): Buffer {
  const payload = Buffer.from(comment, 'utf8');
  const segment = Buffer.alloc(4 + payload.length);
  segment[0] = 0xff;
  segment[1] = 0xfe;
  segment.writeUInt16BE(payload.length + 2, 2);
  payload.copy(segment, 4);
  return Buffer.concat([input.subarray(0, 2), segment, input.subarray(2)]);
}
