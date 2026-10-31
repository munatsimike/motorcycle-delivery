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
import { Prisma, ProfilePhotoStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RiderContext } from '../auth/rider-access.service.js';
import { TooManyRequestsException } from '../auth/too-many-requests.exception.js';
import { HOUR_MS, maxStoredBytes } from './licence.constants.js';
import { lockRiderProfile } from './motorcycle-lock.js';
import { ObjectStorage } from './object-storage.js';
import { ProfilePhotoValidationError, sanitizeProfilePhoto } from './profile-photo-sanitizer.js';
import { PROFILE_PHOTO_UPLOADS_PER_HOUR, profilePhotoRetentionMs } from './profile-photo.constants.js';
import { logStorageFailure } from './storage-log.js';

export type ProfilePhotoMetadata = {
  id: string;
  contentType: string;
  byteSize: number;
  uploadedAt: string;
};

export type ProfilePhotoBytes = {
  bytes: Buffer;
  contentType: string;
};

type StoredPhoto = {
  id: string;
  contentType: string | null;
  byteSize: number | null;
  uploadedAt: Date | null;
  objectKey: string;
  status: ProfilePhotoStatus;
};

@Injectable()
export class ProfilePhotoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorage,
  ) {}

  async upload(rider: RiderContext, bytes: Buffer, now = new Date()): Promise<ProfilePhotoMetadata> {
    const profile = await this.ownedProfile(rider);
    const recent = await this.prisma.riderProfilePhoto.count({
      where: {
        riderProfileId: profile.id,
        uploadedAt: { gte: new Date(now.getTime() - HOUR_MS) },
      },
    });
    if (recent >= PROFILE_PHOTO_UPLOADS_PER_HOUR) {
      throw new TooManyRequestsException('Too many profile photo uploads. Try again later.');
    }

    const id = randomUUID();
    const objectKey = `riders/${profile.id}/profile-photos/${id}`;
    try {
      await this.prisma.riderProfilePhoto.create({
        data: {
          id,
          riderProfileId: profile.id,
          objectKey,
          status: ProfilePhotoStatus.UPLOADING,
          createdAt: now,
        },
      });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new ConflictException('A profile photo upload is already in progress');
      }
      throw error;
    }

    let sanitized;
    try {
      sanitized = await sanitizeProfilePhoto(bytes, maxStoredBytes());
    } catch (error) {
      await this.markPurgePending(id);
      throw mapValidation(error);
    }

    try {
      await this.storage.put(objectKey, sanitized.bytes, sanitized.contentType);
    } catch (error) {
      await this.markPurgePending(id);
      if (!(error instanceof HttpException)) {
        logStorageFailure(error, 'Profile photo');
      }
      throw storageUnavailable(error);
    }

    try {
      const stored = await this.prisma.$transaction(async (tx) => {
        await lockRiderProfile(tx, profile.id, 'Rider profile not found');
        await lockRiderProfilePhotos(tx, profile.id);
        const uploading = await tx.riderProfilePhoto.findUnique({ where: { id } });
        if (!uploading || uploading.status !== ProfilePhotoStatus.UPLOADING || uploading.riderProfileId !== profile.id) {
          throw new ConflictException('Profile photo was removed');
        }
        await tx.riderProfilePhoto.updateMany({
          where: { riderProfileId: profile.id, status: ProfilePhotoStatus.STORED },
          data: {
            status: ProfilePhotoStatus.SUPERSEDED,
            supersededAt: now,
            purgeAfter: new Date(now.getTime() + profilePhotoRetentionMs()),
          },
        });
        return tx.riderProfilePhoto.update({
          where: { id },
          data: {
            status: ProfilePhotoStatus.STORED,
            contentType: sanitized.contentType,
            byteSize: sanitized.bytes.length,
            sha256: createHash('sha256').update(sanitized.bytes).digest('hex'),
            uploadedAt: now,
          },
        });
      });
      return toMetadata(stored);
    } catch (error) {
      await this.markPurgePending(id);
      if (error instanceof HttpException) {
        throw error;
      }
      logStorageFailure(error, 'Profile photo');
      throw new ServiceUnavailableException('Profile photo storage is unavailable');
    }
  }

  async image(rider: RiderContext): Promise<ProfilePhotoBytes> {
    const profile = await this.ownedProfile(rider);
    const photo = await this.currentPhoto(profile.id);
    if (!photo?.contentType) {
      throw new NotFoundException('No profile photo has been uploaded');
    }
    try {
      const bytes = await this.storage.get(photo.objectKey);
      return { bytes, contentType: photo.contentType };
    } catch (error) {
      if (!(error instanceof HttpException)) {
        logStorageFailure(error, 'Profile photo');
      }
      throw storageUnavailable(error);
    }
  }

  async remove(rider: RiderContext, now = new Date()): Promise<void> {
    const profile = await this.ownedProfile(rider);
    await this.prisma.$transaction(async (tx) => {
      await lockRiderProfile(tx, profile.id, 'Rider profile not found');
      await lockRiderProfilePhotos(tx, profile.id);
      await tx.riderProfilePhoto.updateMany({
        where: {
          riderProfileId: profile.id,
          status: { in: [ProfilePhotoStatus.STORED, ProfilePhotoStatus.UPLOADING] },
        },
        data: {
          status: ProfilePhotoStatus.PURGE_PENDING,
          purgeAfter: now,
        },
      });
    });
  }

  async hasPhoto(riderProfileId: string): Promise<boolean> {
    const photo = await this.currentPhoto(riderProfileId);
    return photo !== null;
  }

  private async currentPhoto(riderProfileId: string): Promise<StoredPhoto | null> {
    return this.prisma.riderProfilePhoto.findFirst({
      where: { riderProfileId, status: ProfilePhotoStatus.STORED },
    });
  }

  private async ownedProfile(rider: RiderContext) {
    const profile = await this.prisma.riderProfile.findUnique({ where: { id: rider.riderProfileId } });
    if (!profile || profile.userId !== rider.userId) {
      throw new ForbiddenException('Rider access is required');
    }
    return profile;
  }

  private async markPurgePending(id: string): Promise<void> {
    await this.prisma.riderProfilePhoto.updateMany({
      where: { id, status: ProfilePhotoStatus.UPLOADING },
      data: { status: ProfilePhotoStatus.PURGE_PENDING },
    }).catch(() => undefined);
  }
}

async function lockRiderProfilePhotos(tx: Prisma.TransactionClient, riderProfileId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT "id" FROM "rider_profile_photos" WHERE "rider_profile_id" = CAST(${riderProfileId} AS uuid) FOR UPDATE
  `;
}

function toMetadata(photo: StoredPhoto): ProfilePhotoMetadata {
  if (!photo.contentType || photo.byteSize === null || !photo.uploadedAt) {
    throw new ServiceUnavailableException('Profile photo storage is unavailable');
  }
  return {
    id: photo.id,
    contentType: photo.contentType,
    byteSize: photo.byteSize,
    uploadedAt: photo.uploadedAt.toISOString(),
  };
}

function mapValidation(error: unknown): HttpException {
  if (error instanceof ProfilePhotoValidationError && error.kind === 'size') {
    return new PayloadTooLargeException('Profile photo is too large');
  }
  return new UnsupportedMediaTypeException('Profile photo must be a JPEG, PNG, or WebP file');
}

function storageUnavailable(error: unknown): HttpException {
  if (error instanceof HttpException) {
    return error;
  }
  return new ServiceUnavailableException('Profile photo storage is unavailable');
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
