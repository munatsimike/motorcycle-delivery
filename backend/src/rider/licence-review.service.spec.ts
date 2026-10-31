import { randomUUID } from 'node:crypto';
import { ConflictException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import {
  LicenceImageReviewStatus,
  LicenceImageStatus,
  LicenceReviewDecision,
  Prisma,
  RiderApprovalStatus,
  RiderAvailability,
  RiderVerificationStatus,
} from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { RiderContext } from '../auth/rider-access.service.js';
import { LicenceImageService } from './licence-image.service.js';
import { LicenceReviewService, readLicenceReview } from './licence-review.service.js';
import type { ObjectStorage } from './object-storage.js';

const NOW = new Date('2026-10-13T12:00:00.000Z');
const ADMIN = { userId: 'admin-1' };
const RIDER: RiderContext = { userId: 'user-1', riderProfileId: 'profile-1' };

describe('licence review', () => {
  it('keeps licence facts as entered, aside from trimmed collapsed spaces', () => {
    expect(readLicenceReview({
      decision: 'VERIFY',
      licenceImageId: 'image-1',
      licenceNumber: '  zw   100  ',
      licenceClass: '  class   4 ',
    })).toEqual({
      decision: 'VERIFY',
      licenceImageId: 'image-1',
      licenceNumber: 'zw 100',
      licenceClass: 'class 4',
    });
    expect(() => readLicenceReview({ decision: 'REJECT', licenceImageId: 'image-1', rejectionReason: '   ' })).toThrow();
  });

  it('verifies only the current stored image and records an append-only review', async () => {
    const ctx = context();
    ctx.images.push(stored('image-1'));

    const response = await ctx.service.review(ADMIN, 'profile-1', {
      decision: 'VERIFY',
      licenceImageId: 'image-1',
      licenceNumber: 'ZW 100',
      licenceClass: '4',
    }, NOW);

    expect(response).toEqual({
      riderProfileId: 'profile-1',
      verificationStatus: RiderVerificationStatus.VERIFIED,
      licenceNumber: 'ZW 100',
      licenceClass: '4',
      licenceImageId: 'image-1',
      decision: 'VERIFY',
      rejectionReason: null,
    });
    expect(response).not.toHaveProperty('reviewerId');
    expect(JSON.stringify(response)).not.toContain('riders/');
    expect(ctx.locks).toEqual(['profile', 'image']);
    expect(ctx.profile()).toMatchObject({
      verificationStatus: RiderVerificationStatus.VERIFIED,
      licenceNumber: 'ZW 100',
      licenceClass: '4',
      reviewerId: 'admin-1',
      approvalStatus: RiderApprovalStatus.PENDING,
      availability: RiderAvailability.OFFLINE,
    });
    expect(ctx.reviewRows).toHaveLength(1);
  });

  it('rejects a stale or replaced image without writing a review', async () => {
    const ctx = context();
    ctx.images.push(stored('image-old'));
    ctx.images[0].status = LicenceImageStatus.SUPERSEDED;
    ctx.images.push(stored('image-new'));

    await expect(ctx.service.review(ADMIN, 'profile-1', {
      decision: 'VERIFY',
      licenceImageId: 'image-old',
      licenceNumber: 'ZW 100',
      licenceClass: '4',
    }, NOW)).rejects.toBeInstanceOf(ConflictException);

    expect(ctx.reviewRows).toHaveLength(0);
    expect(ctx.profile().verificationStatus).toBe(RiderVerificationStatus.PENDING);
  });

  it('rejects an image owned by another rider through the composite foreign key', async () => {
    const ctx = context();
    ctx.images.push({ ...stored('image-other'), riderProfileId: 'profile-2' });

    await expect(ctx.db.riderLicenceReview.create({
      data: {
        riderProfileId: 'profile-1',
        licenceImageId: 'image-other',
        decision: LicenceReviewDecision.REJECT,
        licenceNumber: null,
        licenceClass: null,
        rejectionReason: 'Unreadable',
        reviewerId: 'admin-1',
        createdAt: NOW,
      },
    })).rejects.toMatchObject({ code: 'P2003' });
    await expect(ctx.db.riderLicenceReview.update()).rejects.toThrow('append-only');
    await expect(ctx.db.riderLicenceReview.delete()).rejects.toThrow('append-only');
  });

  it('preserves the rejection history when the rider resubmits', async () => {
    const ctx = context();
    ctx.images.push(stored('image-old'));
    await ctx.service.review(ADMIN, 'profile-1', {
      decision: 'REJECT',
      licenceImageId: 'image-old',
      rejectionReason: 'The photo is unreadable',
    }, NOW);
    const history = structuredClone(ctx.reviewRows);

    await ctx.licences.upload(RIDER, await jpeg(), new Date(NOW.getTime() + 60_000));

    expect(ctx.reviewRows).toEqual(history);
    expect(ctx.profile()).toMatchObject({
      verificationStatus: RiderVerificationStatus.PENDING,
      approvalStatus: RiderApprovalStatus.PENDING,
      availability: RiderAvailability.OFFLINE,
      reviewerId: null,
    });
    expect(ctx.images.filter((image) => image.status === LicenceImageStatus.STORED)).toHaveLength(1);
    expect(ctx.images.find((image) => image.id === 'image-old')?.status).toBe(LicenceImageStatus.SUPERSEDED);
  });

  it('does not replace a licence while a review holds the rider lock', async () => {
    const ctx = context();
    ctx.images.push(stored('image-old'));
    ctx.pauseFirstLock = true;
    const reviewing = ctx.service.review(ADMIN, 'profile-1', {
      decision: 'VERIFY',
      licenceImageId: 'image-old',
      licenceNumber: 'ZW 100',
      licenceClass: '4',
    }, NOW);
    await waitUntil(() => ctx.held);

    const uploading = ctx.licences.upload(RIDER, await jpeg(), new Date(NOW.getTime() + 60_000));
    await waitUntil(() => ctx.waiting > 0);
    expect(ctx.images.find((image) => image.id === 'image-old')?.status).toBe(LicenceImageStatus.STORED);

    ctx.releasePause();
    await reviewing;
    await expect(uploading).rejects.toBeInstanceOf(ConflictException);

    expect(ctx.reviewRows).toHaveLength(1);
    expect(ctx.profile().verificationStatus).toBe(RiderVerificationStatus.VERIFIED);
    expect(ctx.images.find((image) => image.id === 'image-old')?.status).toBe(LicenceImageStatus.STORED);
  });

  it('does not verify an image replaced while the upload held the rider lock', async () => {
    const ctx = context();
    ctx.images.push(stored('image-old'));
    ctx.pauseFirstLock = true;
    const uploading = ctx.licences.upload(RIDER, await jpeg(), new Date(NOW.getTime() + 60_000));
    await waitUntil(() => ctx.held);

    const reviewing = ctx.service.review(ADMIN, 'profile-1', {
      decision: 'VERIFY',
      licenceImageId: 'image-old',
      licenceNumber: 'ZW 100',
      licenceClass: '4',
    }, NOW);
    await waitUntil(() => ctx.waiting > 0);
    expect(ctx.reviewRows).toHaveLength(0);

    ctx.releasePause();
    await uploading;
    await expect(reviewing).rejects.toBeInstanceOf(ConflictException);

    expect(ctx.reviewRows).toHaveLength(0);
    expect(ctx.profile().verificationStatus).toBe(RiderVerificationStatus.PENDING);
    expect(ctx.images.find((image) => image.id === 'image-old')?.status).toBe(LicenceImageStatus.SUPERSEDED);
    expect(ctx.images.filter((image) => image.status === LicenceImageStatus.STORED)).toHaveLength(1);
  });

  it('streams the current image without storage details and hides a storage failure', async () => {
    const ctx = context();
    ctx.images.push(stored('image-1'));
    const image = await ctx.service.currentImage('profile-1');
    expect(image).toEqual({ bytes: Buffer.from('private-bytes'), contentType: 'image/jpeg' });
    expect(image).not.toHaveProperty('objectKey');

    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    ctx.storage.get.mockRejectedValueOnce(new Error('failed riders/profile-1/licences/image and storage-secret-value'));
    process.env.LICENCE_STORAGE_SECRET_ACCESS_KEY = 'storage-secret-value';
    await expect(ctx.service.currentImage('profile-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(warn.mock.calls.join(' ')).not.toContain('riders/profile-1');
    expect(warn.mock.calls.join(' ')).not.toContain('storage-secret-value');
    delete process.env.LICENCE_STORAGE_SECRET_ACCESS_KEY;
    warn.mockRestore();

    ctx.images[0].status = LicenceImageStatus.SUPERSEDED;
    await expect(ctx.service.currentImage('profile-1')).rejects.toBeInstanceOf(NotFoundException);
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
  updatedAt: Date;
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

type ReviewRow = {
  id: string;
  riderProfileId: string;
  licenceImageId: string;
  decision: LicenceReviewDecision;
  licenceNumber: string | null;
  licenceClass: string | null;
  rejectionReason: string | null;
  reviewerId: string;
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
    updatedAt: NOW,
  }];
  const images: ImageRow[] = [];
  const reviews: ReviewRow[] = [];
  const locks: string[] = [];
  const state = { pauseFirstLock: false, paused: false, held: false, waiting: 0, generation: 0 };
  let releasePause: () => void = () => undefined;
  const pause = new Promise<void>((resolve) => {
    releasePause = resolve;
  });
  const holders = new Map<string, Promise<void>>();

  const acquire = async (id: string) => {
    while (holders.has(id)) {
      state.waiting += 1;
      const current = holders.get(id);
      await current;
      state.waiting -= 1;
    }
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    holders.set(id, gate);
    state.held = true;
    return () => {
      if (holders.get(id) === gate) {
        holders.delete(id);
      }
      release();
    };
  };

  const matches = (row: ImageRow, where: Record<string, unknown>) => {
    if (typeof where.id === 'string' && row.id !== where.id) return false;
    if (typeof where.riderProfileId === 'string' && row.riderProfileId !== where.riderProfileId) return false;
    if (typeof where.status === 'string' && row.status !== where.status) return false;
    const uploadedAt = where.uploadedAt as { gte?: Date } | undefined;
    if (uploadedAt?.gte && (!row.uploadedAt || row.uploadedAt < uploadedAt.gte)) return false;
    return true;
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
      images.push({
        ...data,
        contentType: data.contentType ?? null,
        byteSize: data.byteSize ?? null,
        sha256: data.sha256 ?? null,
        uploadedAt: data.uploadedAt ?? null,
        supersededAt: data.supersededAt ?? null,
        purgeAfter: data.purgeAfter ?? null,
        purgedAt: data.purgedAt ?? null,
      });
      return images[images.length - 1];
    },
    async delete({ where }: { where: { id: string } }) {
      const index = images.findIndex((row) => row.id === where.id);
      if (index >= 0) images.splice(index, 1);
    },
    async update({ where, data }: { where: { id: string }; data: Partial<ImageRow> }) {
      const row = images.find((image) => image.id === where.id);
      if (!row) throw new Error('image missing');
      if (data.status === LicenceImageStatus.STORED && images.some((image) => image.id !== row.id && image.riderProfileId === row.riderProfileId && image.status === LicenceImageStatus.STORED)) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '7.1.0' });
      }
      Object.assign(row, data);
      return row;
    },
    async updateMany({ where, data }: { where: Record<string, unknown>; data: Partial<ImageRow> }) {
      const matched = images.filter((row) => matches(row, where));
      for (const row of matched) Object.assign(row, data);
      return { count: matched.length };
    },
  };

  const profilesApi = {
    async findUnique({ where }: { where: { id: string } }) {
      return profiles.find((profile) => profile.id === where.id) ?? null;
    },
    async update({ where, data }: { where: { id: string }; data: Partial<ProfileRow> }) {
      const profile = profiles.find((row) => row.id === where.id);
      if (!profile) throw new Error('profile missing');
      Object.assign(profile, data);
      return profile;
    },
    async updateMany({ where, data }: { where: { id: string; verificationStatus?: RiderVerificationStatus }; data: Partial<ProfileRow> }) {
      const matched = profiles.filter((profile) => profile.id === where.id && (!where.verificationStatus || profile.verificationStatus === where.verificationStatus));
      for (const profile of matched) Object.assign(profile, data);
      return { count: matched.length };
    },
  };

  const reviewsApi = {
    async create({ data }: { data: Omit<ReviewRow, 'id'> }) {
      const image = images.find((row) => row.id === data.licenceImageId);
      if (!image || image.riderProfileId !== data.riderProfileId) {
        throw new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', { code: 'P2003', clientVersion: '7.1.0' });
      }
      const row = { id: randomUUID(), ...data };
      reviews.push(row);
      return row;
    },
    async update() {
      throw new Error('rider licence reviews are append-only');
    },
    async delete() {
      throw new Error('rider licence reviews are append-only');
    },
  };

  const storage = {
    put: vi.fn(async () => undefined),
    get: vi.fn(async () => Buffer.from('private-bytes')),
    delete: vi.fn(async () => undefined),
  };

  const db = {
    riderProfile: profilesApi,
    riderLicenceImage: imagesApi,
    riderLicenceReview: reviewsApi,
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join(' ');
      if (sql.includes('rider_profiles') && sql.includes('FOR UPDATE')) {
        const release = await acquire(String(values[0]));
        locks.push('profile');
        if (state.pauseFirstLock && !state.paused) {
          state.paused = true;
          await pause;
        }
        return release;
      }
      if (sql.includes('rider_licence_images') && sql.includes('FOR UPDATE')) {
        locks.push('images');
        if (sql.includes('"id"') && sql.includes('rider_profile_id')) {
          locks[locks.length - 1] = 'image';
        }
      }
      return undefined;
    },
    async $transaction<T>(callback: (tx: object) => Promise<T>) {
      const started = state.generation;
      const profileSnapshot = structuredClone(profiles);
      const imageSnapshot = structuredClone(images);
      const reviewSnapshot = structuredClone(reviews);
      const releases: Array<() => void> = [];
      const tx = {
        ...db,
        async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
          const release = await db.$queryRaw(strings, ...values);
          if (typeof release === 'function') releases.push(release);
          return [];
        },
      };
      try {
        const result = await callback(tx);
        state.generation += 1;
        return result;
      } catch (error) {
        if (state.generation === started) {
          profiles.splice(0, profiles.length, ...profileSnapshot);
          images.splice(0, images.length, ...imageSnapshot);
          reviews.splice(0, reviews.length, ...reviewSnapshot);
        }
        throw error;
      } finally {
        for (const release of releases) release();
      }
    },
  };

  return {
    service: new LicenceReviewService(db as unknown as PrismaService, storage as unknown as ObjectStorage),
    licences: new LicenceImageService(db as unknown as PrismaService, storage as unknown as ObjectStorage),
    db,
    images,
    reviewRows: reviews,
    locks,
    storage,
    profile: () => profiles[0],
    get pauseFirstLock() {
      return state.pauseFirstLock;
    },
    set pauseFirstLock(value: boolean) {
      state.pauseFirstLock = value;
    },
    get held() {
      return state.held;
    },
    get waiting() {
      return state.waiting;
    },
    releasePause: () => releasePause(),
  };
}

function stored(id: string): ImageRow {
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

async function waitUntil(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 1000) {
      throw new Error('timed out waiting for the rider lock');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
