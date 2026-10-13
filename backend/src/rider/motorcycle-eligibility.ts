import { ConflictException } from '@nestjs/common';
import {
  AccountStatus,
  MotorcycleVerificationStatus,
  RiderApprovalStatus,
  RiderVerificationStatus,
} from '../generated/prisma/client.js';

export type AcceptanceRider = {
  accountStatus: AccountStatus;
  phoneVerifiedAt: Date | null;
  approvalStatus: RiderApprovalStatus;
  licenceVerificationStatus: RiderVerificationStatus;
  motorcycles: Array<{
    id: string;
    verificationStatus: MotorcycleVerificationStatus;
    isActive: boolean;
  }>;
};

// Read-only operational eligibility. Approval is separate and does not require
// an active motorcycle. Going online calls this after it locks the rider
// profile, then that rider's motorcycles. The accept transaction calls this
// after it locks the delivery, then the rider profile, then the assignment.
// AVAILABLE is not proof of eligibility. This function does not change
// availability and does not set AVAILABLE or BUSY.
export function motorcycleForAcceptance(rider: AcceptanceRider): string {
  if (rider.accountStatus !== AccountStatus.ACTIVE || rider.phoneVerifiedAt === null) {
    throw new ConflictException('An active verified account is required');
  }
  if (rider.approvalStatus !== RiderApprovalStatus.APPROVED) {
    throw new ConflictException('Rider approval is required');
  }
  if (rider.licenceVerificationStatus !== RiderVerificationStatus.VERIFIED) {
    throw new ConflictException('A verified licence is required');
  }
  const active = rider.motorcycles.filter((motorcycle) => motorcycle.isActive);
  if (active.length !== 1 || active[0].verificationStatus !== MotorcycleVerificationStatus.VERIFIED) {
    throw new ConflictException('An active verified motorcycle is required');
  }
  return active[0].id;
}
