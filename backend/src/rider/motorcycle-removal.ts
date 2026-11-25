import { MotorcycleVerificationStatus } from '../generated/prisma/client.js';

export type RemainingMotorcycle = {
  id: string;
  verificationStatus: MotorcycleVerificationStatus;
  isActive: boolean;
};

export type ActiveMotorbikeSuccessor =
  | { action: 'keep' }
  | { action: 'activate'; motorcycleId: string }
  | { action: 'offline' };

// Removing an inactive motorbike leaves the current active motorbike alone.
// Removing the active one activates the only remaining approved motorbike.
// Any other result takes the rider offline and never selects an unapproved motorbike.
export function activeMotorbikeSuccessor(
  removedWasActive: boolean,
  remaining: readonly RemainingMotorcycle[],
): ActiveMotorbikeSuccessor {
  if (!removedWasActive) {
    const activeApproved = remaining.some((row) =>
      row.isActive && row.verificationStatus === MotorcycleVerificationStatus.VERIFIED);
    return activeApproved ? { action: 'keep' } : { action: 'offline' };
  }
  const approved = remaining.filter((row) => row.verificationStatus === MotorcycleVerificationStatus.VERIFIED);
  if (approved.length === 1) {
    return { action: 'activate', motorcycleId: approved[0].id };
  }
  return { action: 'offline' };
}
