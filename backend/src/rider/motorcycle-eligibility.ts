import { ConflictException } from '@nestjs/common';
import { AccountStatus, MotorcycleVerificationStatus, RiderApprovalStatus } from '../generated/prisma/client.js';

export type AcceptanceRider = {
  accountStatus: AccountStatus;
  approvalStatus: RiderApprovalStatus;
  motorcycles: Array<{
    id: string;
    verificationStatus: MotorcycleVerificationStatus;
    isActive: boolean;
  }>;
};

// Read-only. The accept transaction calls this after it locks the delivery,
// then the rider profile, then the assignment. It does not change availability.
export function motorcycleForAcceptance(rider: AcceptanceRider): string {
  if (rider.accountStatus !== AccountStatus.ACTIVE || rider.approvalStatus !== RiderApprovalStatus.APPROVED) {
    throw new ConflictException('Rider approval is required');
  }
  const active = rider.motorcycles.filter((motorcycle) => motorcycle.isActive);
  if (active.length !== 1 || active[0].verificationStatus !== MotorcycleVerificationStatus.VERIFIED) {
    throw new ConflictException('An active verified motorcycle is required');
  }
  return active[0].id;
}
