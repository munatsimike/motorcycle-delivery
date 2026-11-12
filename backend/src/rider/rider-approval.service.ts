import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  MotorcycleVerificationStatus,
  Prisma,
  RiderApprovalAuditAction,
  RiderApprovalStatus,
  RiderAvailability,
  RiderVerificationStatus,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AdminContext } from '../auth/admin-access.service.js';
import { adminPage, readAdminPage } from '../http/admin-query.js';
import { ensureDefaultMotorcycle } from './motorcycle-default.js';
import { hasAcceptedAssignment, lockRiderMotorcycles, lockRiderProfile } from './motorcycle-lock.js';
import { awardWelcomeBonus } from './wallet-ledger.js';
import { recordRiderApproved } from '../delivery/v2-outbox.js';

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
    admin: AdminContext,
    riderProfileId: string,
    decision: ApprovalDecision,
    now = new Date(),
  ): Promise<RiderApprovalResponse> {
    return this.prisma.$transaction((tx) => applyDecision(tx, admin, riderProfileId, decision, now));
  }

  async listAudits(riderProfileId: string, query: Record<string, unknown>) {
    const rider = await this.prisma.riderProfile.findUnique({
      where: { id: riderProfileId },
      select: { id: true },
    });
    if (!rider) {
      throw new NotFoundException('Rider profile not found');
    }
    const page = readAdminPage(query.page, 1, 1, 100000);
    const limit = readAdminPage(query.limit, 20, 1, 100);
    const [total, rows] = await Promise.all([
      this.prisma.riderApprovalAudit.count({ where: { riderProfileId } }),
      this.prisma.riderApprovalAudit.findMany({
        where: { riderProfileId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          actorId: true,
          action: true,
          previousApprovalStatus: true,
          newApprovalStatus: true,
          createdAt: true,
        },
      }),
    ]);
    return {
      data: rows,
      pagination: adminPage(page, limit, total),
    };
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
  admin: AdminContext,
  riderProfileId: string,
  decision: ApprovalDecision,
  now: Date,
): Promise<RiderApprovalResponse> {
  const profile = await lockRiderProfile(tx, riderProfileId, 'Rider profile not found');
  if (decision === 'APPROVE') {
    return approve(tx, admin, profile.id, profile.approvalStatus, profile.verificationStatus, now);
  }
  return suspend(
    tx,
    admin,
    profile.id,
    profile.approvalStatus,
    await hasAcceptedAssignment(tx, profile.id),
    now,
  );
}

async function approve(
  tx: Prisma.TransactionClient,
  admin: AdminContext,
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
  await lockRiderMotorcycles(tx, riderProfileId);
  await ensureDefaultMotorcycle(tx, riderProfileId, now);
  await recordApprovalAudit(tx, {
    riderProfileId,
    actorId: admin.userId,
    action: RiderApprovalAuditAction.APPROVE,
    previousApprovalStatus: approvalStatus,
    newApprovalStatus: updated.approvalStatus,
    createdAt: now,
  });
  await awardWelcomeBonus(tx, riderProfileId, admin, now);
  await recordRiderApproved(tx, { riderProfileId, approvedAt: now });
  return toResponse(updated);
}

async function suspend(
  tx: Prisma.TransactionClient,
  admin: AdminContext,
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
  await recordApprovalAudit(tx, {
    riderProfileId,
    actorId: admin.userId,
    action: RiderApprovalAuditAction.SUSPEND,
    previousApprovalStatus: approvalStatus,
    newApprovalStatus: updated.approvalStatus,
    createdAt: now,
  });
  return toResponse(updated);
}

async function recordApprovalAudit(
  tx: Prisma.TransactionClient,
  data: {
    riderProfileId: string;
    actorId: string;
    action: RiderApprovalAuditAction;
    previousApprovalStatus: RiderApprovalStatus;
    newApprovalStatus: RiderApprovalStatus;
    createdAt: Date;
  },
): Promise<void> {
  await tx.riderApprovalAudit.create({ data });
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
