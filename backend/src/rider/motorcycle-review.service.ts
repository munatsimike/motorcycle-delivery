import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MotorcycleVerificationStatus, Prisma, RiderAvailability } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AdminContext } from '../auth/admin-access.service.js';
import { hasAcceptedAssignment, lockMotorcycle, lockRiderProfile } from './motorcycle-lock.js';
import type { MotorcycleResponse } from './motorcycle.service.js';

export type VerificationDecision = 'VERIFY' | 'REJECT' | 'REVOKE';

export type MotorcycleReviewResponse = MotorcycleResponse & {
  verifiedAt: string | null;
  rejectedAt: string | null;
  revokedAt: string | null;
};

type ReviewRow = {
  id: string;
  riderProfileId: string;
  registrationNumber: string;
  make: string;
  model: string;
  colour: string;
  verificationStatus: MotorcycleVerificationStatus;
  isActive: boolean;
  verifiedAt: Date | null;
  verifiedById: string | null;
  rejectedAt: Date | null;
  rejectedById: string | null;
  revokedAt: Date | null;
  revokedById: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class MotorcycleReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async review(admin: AdminContext, motorcycleId: string, decision: VerificationDecision, now = new Date()): Promise<MotorcycleReviewResponse> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.motorcycle.findUnique({ where: { id: motorcycleId } });
      if (!existing) {
        throw new NotFoundException('Motorcycle not found');
      }
      const profile = await lockRiderProfile(tx, existing.riderProfileId);
      await lockMotorcycle(tx, existing.id, existing.riderProfileId);
      const current = await tx.motorcycle.findUnique({ where: { id: existing.id } });
      if (!current) {
        throw new NotFoundException('Motorcycle not found');
      }

      if (decision === 'VERIFY') {
        return toReview(await verify(tx, current, admin.userId, now));
      }
      if (decision === 'REJECT') {
        return toReview(await reject(tx, current, admin.userId, now));
      }
      return toReview(await revoke(
        tx,
        current,
        profile.availability,
        await hasAcceptedAssignment(tx, profile.id),
        admin.userId,
        now,
      ));
    });
  }
}

async function verify(tx: Prisma.TransactionClient, current: ReviewRow, adminId: string, now: Date): Promise<ReviewRow> {
  if (current.verificationStatus !== MotorcycleVerificationStatus.PENDING) {
    throw new ConflictException('Only a pending motorcycle can be verified');
  }
  return tx.motorcycle.update({
    where: { id: current.id },
    data: {
      verificationStatus: MotorcycleVerificationStatus.VERIFIED,
      verifiedAt: now,
      verifiedById: adminId,
      updatedAt: now,
    },
  });
}

async function reject(tx: Prisma.TransactionClient, current: ReviewRow, adminId: string, now: Date): Promise<ReviewRow> {
  if (current.verificationStatus !== MotorcycleVerificationStatus.PENDING) {
    throw new ConflictException('Only a pending motorcycle can be rejected');
  }
  return tx.motorcycle.update({
    where: { id: current.id },
    data: {
      verificationStatus: MotorcycleVerificationStatus.REJECTED,
      rejectedAt: now,
      rejectedById: adminId,
      updatedAt: now,
    },
  });
}

async function revoke(
  tx: Prisma.TransactionClient,
  current: ReviewRow,
  availability: RiderAvailability,
  accepted: boolean,
  adminId: string,
  now: Date,
): Promise<ReviewRow> {
  if (current.verificationStatus !== MotorcycleVerificationStatus.VERIFIED) {
    throw new ConflictException('Only a verified motorcycle can be revoked');
  }
  if (availability !== RiderAvailability.OFFLINE || accepted) {
    throw new ConflictException('This motorcycle cannot be revoked during a delivery');
  }
  await tx.motorcycle.updateMany({
    where: { id: current.id, isActive: true },
    data: { isActive: false, updatedAt: now },
  });
  return tx.motorcycle.update({
    where: { id: current.id },
    data: {
      verificationStatus: MotorcycleVerificationStatus.REVOKED,
      isActive: false,
      revokedAt: now,
      revokedById: adminId,
      updatedAt: now,
    },
  });
}

function toReview(row: ReviewRow): MotorcycleReviewResponse {
  return {
    id: row.id,
    registrationNumber: row.registrationNumber,
    make: row.make,
    model: row.model,
    colour: row.colour,
    verificationStatus: row.verificationStatus,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    rejectedAt: row.rejectedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}
