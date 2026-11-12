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
import type { CustomerContext } from '../auth/customer-access.service.js';
import { TooManyRequestsException } from '../auth/too-many-requests.exception.js';
import { HOUR_MS, maxStoredBytes } from './licence.constants.js';
import { ObjectStorage } from './object-storage.js';
import { ProfilePhotoValidationError, sanitizeProfilePhoto } from './profile-photo-sanitizer.js';
import { PROFILE_PHOTO_UPLOADS_PER_HOUR, profilePhotoRetentionMs } from './profile-photo.constants.js';
import { logStorageFailure } from './storage-log.js';
import type { ProfilePhotoBytes, ProfilePhotoMetadata } from './profile-photo.service.js';

type StoredPhoto = {
  id: string;
  contentType: string | null;
  byteSize: number | null;
  uploadedAt: Date | null;
  objectKey: string;
  status: ProfilePhotoStatus;
};

@Injectable()
export class CustomerAccountProfilePhotoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorage,
  ) {}

  async upload(customer: CustomerContext, bytes: Buffer, now = new Date()): Promise<ProfilePhotoMetadata> {
    const account = await this.ownedAccount(customer);
    const recent = await this.prisma.customerProfilePhoto.count({
      where: {
        customerAccountId: account.id,
        uploadedAt: { gte: new Date(now.getTime() - HOUR_MS) },
      },
    });
    if (recent >= PROFILE_PHOTO_UPLOADS_PER_HOUR) {
      throw new TooManyRequestsException('Too many profile photo uploads. Try again later.');
    }

    const id = randomUUID();
    const objectKey = `customers/${account.id}/profile-photos/${id}`;
    try {
      await this.prisma.customerProfilePhoto.create({
        data: {
          id,
          customerAccountId: account.id,
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
        await lockCustomerAccount(tx, account.id);
        await lockCustomerProfilePhotos(tx, account.id);
        const uploading = await tx.customerProfilePhoto.findUnique({ where: { id } });
        if (!uploading || uploading.status !== ProfilePhotoStatus.UPLOADING || uploading.customerAccountId !== account.id) {
          throw new ConflictException('Profile photo was removed');
        }
        await tx.customerProfilePhoto.updateMany({
          where: { customerAccountId: account.id, status: ProfilePhotoStatus.STORED },
          data: {
            status: ProfilePhotoStatus.SUPERSEDED,
            supersededAt: now,
            purgeAfter: new Date(now.getTime() + profilePhotoRetentionMs()),
          },
        });
        return tx.customerProfilePhoto.update({
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

  async image(customer: CustomerContext): Promise<ProfilePhotoBytes> {
    const account = await this.ownedAccount(customer);
    const photo = await this.currentPhoto(account.id);
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

  async remove(customer: CustomerContext, now = new Date()): Promise<void> {
    const account = await this.ownedAccount(customer);
    await this.prisma.$transaction(async (tx) => {
      await lockCustomerAccount(tx, account.id);
      await lockCustomerProfilePhotos(tx, account.id);
      await tx.customerProfilePhoto.updateMany({
        where: {
          customerAccountId: account.id,
          status: { in: [ProfilePhotoStatus.STORED, ProfilePhotoStatus.UPLOADING] },
        },
        data: {
          status: ProfilePhotoStatus.PURGE_PENDING,
          purgeAfter: now,
        },
      });
    });
  }

  private async currentPhoto(customerAccountId: string): Promise<StoredPhoto | null> {
    return this.prisma.customerProfilePhoto.findFirst({
      where: { customerAccountId, status: ProfilePhotoStatus.STORED },
    });
  }

  private async ownedAccount(customer: CustomerContext) {
    const account = await this.prisma.customerAccount.findUnique({ where: { id: customer.customerAccountId } });
    if (!account || account.userId !== customer.userId) {
      throw new ForbiddenException('Customer access is required');
    }
    return account;
  }

  private async markPurgePending(id: string): Promise<void> {
    await this.prisma.customerProfilePhoto.updateMany({
      where: { id, status: ProfilePhotoStatus.UPLOADING },
      data: { status: ProfilePhotoStatus.PURGE_PENDING },
    }).catch(() => undefined);
  }
}

async function lockCustomerAccount(tx: Prisma.TransactionClient, customerAccountId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT "id" FROM "customer_accounts" WHERE "id" = CAST(${customerAccountId} AS uuid) FOR UPDATE
  `;
}

async function lockCustomerProfilePhotos(tx: Prisma.TransactionClient, customerAccountId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT "id" FROM "customer_profile_photos" WHERE "customer_account_id" = CAST(${customerAccountId} AS uuid) FOR UPDATE
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
