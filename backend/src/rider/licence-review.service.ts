import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  LicenceImageStatus,
  LicenceReviewDecision,
  Prisma,
  RiderVerificationStatus,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AdminContext } from '../auth/admin-access.service.js';
import { lockLicenceImage, lockRiderProfile } from './motorcycle-lock.js';
import { ObjectStorage } from './object-storage.js';
import { logStorageFailure } from './storage-log.js';

const LICENCE_NUMBER_MAX = 50;
const LICENCE_CLASS_MAX = 40;
const REJECTION_REASON_MAX = 500;

export type LicenceReviewCommand =
  | { decision: 'VERIFY'; licenceImageId: string; licenceNumber: string; licenceClass: string }
  | { decision: 'REJECT'; licenceImageId: string; rejectionReason: string };

export type LicenceReviewResponse = {
  riderProfileId: string;
  verificationStatus: RiderVerificationStatus;
  licenceNumber: string | null;
  licenceClass: string | null;
  licenceImageId: string;
  decision: 'VERIFY' | 'REJECT';
  rejectionReason: string | null;
};

export type LicenceImageBytes = {
  bytes: Buffer;
  contentType: string;
};

@Injectable()
export class LicenceReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorage,
  ) {}

  async review(
    admin: AdminContext,
    riderProfileId: string,
    command: LicenceReviewCommand,
    now = new Date(),
  ): Promise<LicenceReviewResponse> {
    try {
      return await this.prisma.$transaction((tx) => applyReview(tx, admin.userId, riderProfileId, command, now));
    } catch (error) {
      if (isForeignKeyConstraint(error)) {
        throw new ConflictException('This licence image can no longer be reviewed');
      }
      throw error;
    }
  }

  async currentImage(riderProfileId: string): Promise<LicenceImageBytes> {
    const image = await this.prisma.riderLicenceImage.findFirst({
      where: { riderProfileId, status: LicenceImageStatus.STORED },
    });
    if (!image?.contentType || !image.objectKey) {
      throw new NotFoundException('Licence image not found');
    }
    try {
      const bytes = await this.storage.get(image.objectKey);
      return { bytes, contentType: image.contentType };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      logStorageFailure(error);
      throw new ServiceUnavailableException('Licence image storage is unavailable');
    }
  }
}

export function readLicenceReview(body: unknown): LicenceReviewCommand {
  if (typeof body !== 'object' || body === null) {
    throw new BadRequestException('Choose a licence verification decision');
  }
  const record = body as Record<string, unknown>;
  const licenceImageId = readImageId(record.licenceImageId);
  if (record.decision === 'VERIFY') {
    return {
      decision: 'VERIFY',
      licenceImageId,
      licenceNumber: licenceFact(record.licenceNumber, 'licence number', LICENCE_NUMBER_MAX),
      licenceClass: licenceFact(record.licenceClass, 'licence class', LICENCE_CLASS_MAX),
    };
  }
  if (record.decision === 'REJECT') {
    return {
      decision: 'REJECT',
      licenceImageId,
      rejectionReason: rejectionReason(record.rejectionReason),
    };
  }
  throw new BadRequestException('Choose a licence verification decision');
}

async function applyReview(
  tx: Prisma.TransactionClient,
  reviewerId: string,
  riderProfileId: string,
  command: LicenceReviewCommand,
  now: Date,
): Promise<LicenceReviewResponse> {
  const profile = await lockRiderProfile(tx, riderProfileId, 'Rider profile not found');
  await lockLicenceImage(tx, command.licenceImageId, riderProfileId);
  const image = await tx.riderLicenceImage.findFirst({
    where: {
      id: command.licenceImageId,
      riderProfileId,
      status: LicenceImageStatus.STORED,
    },
  });
  if (!image || profile.verificationStatus !== RiderVerificationStatus.PENDING) {
    throw new ConflictException('This licence image can no longer be reviewed');
  }

  if (command.decision === 'VERIFY') {
    await tx.riderLicenceReview.create({
      data: {
        riderProfileId,
        licenceImageId: image.id,
        decision: LicenceReviewDecision.VERIFY,
        licenceNumber: command.licenceNumber,
        licenceClass: command.licenceClass,
        rejectionReason: null,
        reviewerId,
        createdAt: now,
      },
    });
    const updated = await tx.riderProfile.update({
      where: { id: profile.id },
      data: {
        verificationStatus: RiderVerificationStatus.VERIFIED,
        licenceNumber: command.licenceNumber,
        licenceClass: command.licenceClass,
        verifiedAt: now,
        reviewerId,
        updatedAt: now,
      },
    });
    return {
      riderProfileId: updated.id,
      verificationStatus: updated.verificationStatus,
      licenceNumber: updated.licenceNumber,
      licenceClass: updated.licenceClass,
      licenceImageId: image.id,
      decision: 'VERIFY',
      rejectionReason: null,
    };
  }

  await tx.riderLicenceReview.create({
    data: {
      riderProfileId,
      licenceImageId: image.id,
      decision: LicenceReviewDecision.REJECT,
      licenceNumber: null,
      licenceClass: null,
      rejectionReason: command.rejectionReason,
      reviewerId,
      createdAt: now,
    },
  });
  const updated = await tx.riderProfile.update({
    where: { id: profile.id },
    data: {
      verificationStatus: RiderVerificationStatus.REJECTED,
      licenceNumber: null,
      licenceClass: null,
      verifiedAt: null,
      reviewerId,
      updatedAt: now,
    },
  });
  return {
    riderProfileId: updated.id,
    verificationStatus: updated.verificationStatus,
    licenceNumber: null,
    licenceClass: null,
    licenceImageId: image.id,
    decision: 'REJECT',
    rejectionReason: command.rejectionReason,
  };
}

function readImageId(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException('Choose the licence image to review');
  }
  return value.trim();
}

function licenceFact(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(`Enter the ${label}`);
  }
  const collapsed = value.trim().replace(/\s+/g, ' ');
  if (collapsed.length === 0 || collapsed.length > max) {
    throw new BadRequestException(`Enter the ${label}`);
  }
  return collapsed;
}

function rejectionReason(value: unknown): string {
  if (typeof value !== 'string') {
    throw new BadRequestException('Enter the rejection reason');
  }
  const reason = value.trim();
  if (reason.length === 0 || reason.length > REJECTION_REASON_MAX) {
    throw new BadRequestException('Enter the rejection reason');
  }
  return reason;
}

function isForeignKeyConstraint(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003';
}
