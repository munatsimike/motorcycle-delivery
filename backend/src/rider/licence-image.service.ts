import { createHash, randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  LicenceImageReviewStatus,
  LicenceImageStatus,
  Prisma,
  RiderVerificationStatus,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RiderContext } from '../auth/rider-access.service.js';
import { TooManyRequestsException } from '../auth/too-many-requests.exception.js';
import { LicenceImageValidationError, sanitizeLicenceImage } from './image-sanitizer.js';
import {
  HOUR_MS,
  LICENCE_UPLOADS_PER_HOUR,
  maxStoredBytes,
  supersededRetentionMs,
} from './licence.constants.js';
import { lockRiderLicenceImages, lockRiderProfile } from './motorcycle-lock.js';
import { ObjectStorage } from './object-storage.js';
import { logStorageFailure } from './storage-log.js';

export type LicenceImageResponse = {
  id: string;
  reviewStatus: LicenceImageReviewStatus;
  contentType: string;
  byteSize: number;
  uploadedAt: string;
};

type StoredImage = {
  id: string;
  reviewStatus: LicenceImageReviewStatus;
  contentType: string | null;
  byteSize: number | null;
  uploadedAt: Date | null;
};

@Injectable()
export class LicenceImageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorage,
  ) {}

  async upload(rider: RiderContext, bytes: Buffer, now = new Date()): Promise<LicenceImageResponse> {
    const profile = await this.ownedProfile(rider);
    if (profile.verificationStatus === RiderVerificationStatus.VERIFIED) {
      throw new ConflictException('A verified licence cannot be replaced yet');
    }

    const recent = await this.prisma.riderLicenceImage.count({
      where: {
        riderProfileId: profile.id,
        uploadedAt: { gte: new Date(now.getTime() - HOUR_MS) },
      },
    });
    if (recent >= LICENCE_UPLOADS_PER_HOUR) {
      throw new TooManyRequestsException('Too many licence image uploads. Try again later.');
    }

    const id = randomUUID();
    const objectKey = `riders/${profile.id}/licences/${id}`;
    try {
      await this.prisma.riderLicenceImage.create({
        data: {
          id,
          riderProfileId: profile.id,
          objectKey,
          status: LicenceImageStatus.UPLOADING,
          reviewStatus: LicenceImageReviewStatus.PENDING,
          createdAt: now,
        },
      });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new ConflictException('A licence image upload is already in progress');
      }
      throw error;
    }

    let sanitized;
    try {
      sanitized = await sanitizeLicenceImage(bytes, maxStoredBytes());
    } catch (error) {
      await this.prisma.riderLicenceImage.delete({ where: { id } }).catch(() => undefined);
      throw mapValidation(error);
    }

    try {
      await this.storage.put(objectKey, sanitized.bytes, sanitized.contentType);
    } catch (error) {
      await this.markPurgePending(id);
      if (!(error instanceof HttpException)) {
        logStorageFailure(error);
      }
      throw storageUnavailable(error);
    }

    try {
      const stored = await this.prisma.$transaction(async (tx) => {
        const current = await lockRiderProfile(tx, profile.id, 'Rider profile not found');
        if (current.verificationStatus === RiderVerificationStatus.VERIFIED) {
          throw new ConflictException('A verified licence cannot be replaced yet');
        }
        await lockRiderLicenceImages(tx, profile.id);

        await tx.riderLicenceImage.updateMany({
          where: { riderProfileId: profile.id, status: LicenceImageStatus.STORED },
          data: {
            status: LicenceImageStatus.SUPERSEDED,
            supersededAt: now,
            purgeAfter: new Date(now.getTime() + supersededRetentionMs()),
          },
        });
        const saved = await tx.riderLicenceImage.update({
          where: { id },
          data: {
            status: LicenceImageStatus.STORED,
            contentType: sanitized.contentType,
            byteSize: sanitized.bytes.length,
            sha256: createHash('sha256').update(sanitized.bytes).digest('hex'),
            uploadedAt: now,
          },
        });
        if (current.verificationStatus === RiderVerificationStatus.REJECTED) {
          await tx.riderProfile.updateMany({
            where: { id: profile.id, verificationStatus: RiderVerificationStatus.REJECTED },
            data: { verificationStatus: RiderVerificationStatus.PENDING, reviewerId: null },
          });
        }
        return saved;
      });
      return toResponse(stored);
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) {
        await this.markPurgePending(id);
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      logStorageFailure(error);
      throw new ServiceUnavailableException('Licence image storage is unavailable');
    }
  }

  async current(rider: RiderContext): Promise<LicenceImageResponse> {
    const profile = await this.ownedProfile(rider);
    const image = await this.prisma.riderLicenceImage.findFirst({
      where: { riderProfileId: profile.id, status: LicenceImageStatus.STORED },
    });
    if (!image) {
      throw new NotFoundException('No licence image has been uploaded');
    }
    return toResponse(image);
  }

  private async ownedProfile(rider: RiderContext) {
    const profile = await this.prisma.riderProfile.findUnique({ where: { id: rider.riderProfileId } });
    if (!profile || profile.userId !== rider.userId) {
      throw new ForbiddenException('Rider access is required');
    }
    return profile;
  }

  private async markPurgePending(id: string): Promise<void> {
    await this.prisma.riderLicenceImage.updateMany({
      where: { id, status: LicenceImageStatus.UPLOADING },
      data: { status: LicenceImageStatus.PURGE_PENDING },
    }).catch(() => undefined);
  }
}

function toResponse(image: StoredImage): LicenceImageResponse {
  if (!image.contentType || image.byteSize === null || !image.uploadedAt) {
    throw new ServiceUnavailableException('Licence image storage is unavailable');
  }
  return {
    id: image.id,
    reviewStatus: image.reviewStatus,
    contentType: image.contentType,
    byteSize: image.byteSize,
    uploadedAt: image.uploadedAt.toISOString(),
  };
}

function mapValidation(error: unknown): HttpException {
  if (error instanceof LicenceImageValidationError && error.kind === 'size') {
    return new PayloadTooLargeException('Licence image is too large');
  }
  return new UnsupportedMediaTypeException('Licence image must be a JPEG, PNG, or WebP file');
}

function storageUnavailable(error: unknown): HttpException {
  if (error instanceof HttpException) {
    return error;
  }
  return new ServiceUnavailableException('Licence image storage is unavailable');
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
