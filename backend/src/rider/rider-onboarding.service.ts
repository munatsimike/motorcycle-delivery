import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AccountStatus,
  LicenceReviewDecision,
  MotorcycleVerificationStatus,
  RiderApprovalStatus,
  RiderAvailability,
  RiderVerificationStatus,
  UserRole,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RiderContext } from '../auth/rider-access.service.js';

export type RiderProfileResponse = {
  fullName: string;
  phone: string;
};

export type RiderOnboardingResponse = {
  licenceVerificationStatus: RiderVerificationStatus;
  approvalStatus: RiderApprovalStatus;
  availability: RiderAvailability;
  licenceNumber: string | null;
  licenceClass: string | null;
  rejectionReason: string | null;
  verifiedMotorcycleCount: number;
  activeVerifiedMotorcycle: boolean;
};

@Injectable()
export class RiderOnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  async profile(rider: RiderContext): Promise<RiderProfileResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: rider.userId },
      select: { fullName: true, phone: true, role: true, accountStatus: true },
    });
    if (!user || user.role !== UserRole.RIDER || user.accountStatus !== AccountStatus.ACTIVE) {
      throw new ForbiddenException('Rider access is required');
    }
    return { fullName: user.fullName, phone: user.phone };
  }

  async current(rider: RiderContext): Promise<RiderOnboardingResponse> {
    const profile = await this.prisma.riderProfile.findUnique({ where: { id: rider.riderProfileId } });
    if (!profile) {
      throw new NotFoundException('Rider profile not found');
    }
    if (profile.userId !== rider.userId) {
      throw new ForbiddenException('Rider access is required');
    }

    const verified = profile.verificationStatus === RiderVerificationStatus.VERIFIED;
    const [reviews, verifiedMotorcycleCount, activeVerifiedMotorcycle] = await Promise.all([
      this.prisma.riderLicenceReview.findMany({
        where: { riderProfileId: profile.id },
        orderBy: { createdAt: 'desc' },
        take: 1,
      }),
      this.prisma.motorcycle.count({
        where: { riderProfileId: profile.id, verificationStatus: MotorcycleVerificationStatus.VERIFIED },
      }),
      this.prisma.motorcycle.count({
        where: {
          riderProfileId: profile.id,
          verificationStatus: MotorcycleVerificationStatus.VERIFIED,
          isActive: true,
        },
      }),
    ]);
    const latest = reviews[0];
    return {
      licenceVerificationStatus: profile.verificationStatus,
      approvalStatus: profile.approvalStatus,
      availability: profile.availability,
      licenceNumber: verified ? profile.licenceNumber : null,
      licenceClass: verified ? profile.licenceClass : null,
      rejectionReason: latest?.decision === LicenceReviewDecision.REJECT ? latest.rejectionReason : null,
      verifiedMotorcycleCount,
      activeVerifiedMotorcycle: activeVerifiedMotorcycle === 1,
    };
  }
}
