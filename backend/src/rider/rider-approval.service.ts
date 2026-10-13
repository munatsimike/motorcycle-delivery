import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  MotorcycleVerificationStatus,
  Prisma,
  RiderApprovalStatus,
  RiderAvailability,
  RiderVerificationStatus,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AdminContext } from '../auth/admin-access.service.js';
import { hasAcceptedAssignment, lockRiderProfile } from './motorcycle-lock.js';

export type ApprovalDecision = 'APPROVE' | 'SUSPEND';

export type RiderApprovalResponse = {
  riderProfileId: string;
  approvalStatus: RiderApprovalStatus;
  availability: RiderAvailability;
  verificationStatus: RiderVerificationStatus;
};

@Injectable()
export class RiderApprovalService {
  constructor(private readonly prisma: PrismaService) {}

  async decide(
    _admin: AdminContext,
    riderProfileId: string,
    decision: ApprovalDecision,
    now = new Date(),
  ): Promise<RiderApprovalResponse> {
    return this.prisma.$transaction((tx) => applyDecision(tx, riderProfileId, decision, now));
  }
}

export function readApprovalDecision(body: unknown): ApprovalDecision {
  if (typeof body !== 'object' || body === null || !('decision' in body)) {
    throw new BadRequestException('Choose an approval decision');
  }
  const decision = (body as { decision: unknown }).decision;
  if (decision !== 'APPROVE' && decision !== 'SUSPEND') {
    throw new BadRequestException('Choose an approval decision');
  }
  return decision;
}

async function applyDecision(
  tx: Prisma.TransactionClient,
  riderProfileId: string,
  decision: ApprovalDecision,
  now: Date,
): Promise<RiderApprovalResponse> {
  const profile = await lockRiderProfile(tx, riderProfileId, 'Rider profile not found');
  if (decision === 'APPROVE') {
    return approve(tx, profile.id, profile.approvalStatus, profile.verificationStatus, now);
  }
  return suspend(
    tx,
    profile.id,
    profile.approvalStatus,
    await hasAcceptedAssignment(tx, profile.id),
    now,
  );
}

async function approve(
  tx: Prisma.TransactionClient,
  riderProfileId: string,
  approvalStatus: RiderApprovalStatus,
  verificationStatus: RiderVerificationStatus,
  now: Date,
): Promise<RiderApprovalResponse> {
  if (approvalStatus !== RiderApprovalStatus.PENDING && approvalStatus !== RiderApprovalStatus.SUSPENDED) {
    throw new ConflictException('This rider cannot be approved');
  }
  if (verificationStatus !== RiderVerificationStatus.VERIFIED) {
    throw new ConflictException('A verified licence is required');
  }
  const verifiedMotorcycles = await tx.motorcycle.count({
    where: { riderProfileId, verificationStatus: MotorcycleVerificationStatus.VERIFIED },
  });
  if (verifiedMotorcycles < 1) {
    throw new ConflictException('A verified motorcycle is required');
  }
  const updated = await tx.riderProfile.update({
    where: { id: riderProfileId },
    data: { approvalStatus: RiderApprovalStatus.APPROVED, updatedAt: now },
  });
  return toResponse(updated);
}

async function suspend(
  tx: Prisma.TransactionClient,
  riderProfileId: string,
  approvalStatus: RiderApprovalStatus,
  accepted: boolean,
  now: Date,
): Promise<RiderApprovalResponse> {
  if (approvalStatus !== RiderApprovalStatus.APPROVED) {
    throw new ConflictException('Only an approved rider can be suspended');
  }
  if (accepted) {
    throw new ConflictException('This rider cannot be suspended during a delivery');
  }
  const updated = await tx.riderProfile.update({
    where: { id: riderProfileId },
    data: {
      approvalStatus: RiderApprovalStatus.SUSPENDED,
      availability: RiderAvailability.OFFLINE,
      updatedAt: now,
    },
  });
  return toResponse(updated);
}

function toResponse(profile: {
  id: string;
  approvalStatus: RiderApprovalStatus;
  availability: RiderAvailability;
  verificationStatus: RiderVerificationStatus;
}): RiderApprovalResponse {
  return {
    riderProfileId: profile.id,
    approvalStatus: profile.approvalStatus,
    availability: profile.availability,
    verificationStatus: profile.verificationStatus,
  };
}
