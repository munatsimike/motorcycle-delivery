export type LicenceVerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';
export type RiderApprovalStatus = 'PENDING' | 'APPROVED' | 'SUSPENDED' | 'REJECTED';
export type RiderAvailability = 'OFFLINE' | 'AVAILABLE' | 'BUSY';

export type RiderOnboarding = {
  licenceVerificationStatus: LicenceVerificationStatus;
  approvalStatus: RiderApprovalStatus;
  availability: RiderAvailability;
  licenceNumber: string | null;
  licenceClass: string | null;
  rejectionReason: string | null;
  verifiedMotorcycleCount: number;
  activeVerifiedMotorcycle: boolean;
};

export type RiderOnboardingRepository = {
  load(accessToken: string): Promise<RiderOnboarding>;
};

export type RiderReadiness = {
  canAcceptDeliveries: false;
  availabilityLabel: string;
  licenceLabel: string;
  approvalLabel: string;
  message: string;
};

const LICENCE_LABELS: Record<LicenceVerificationStatus, string> = {
  PENDING: 'Pending review',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
};

const APPROVAL_LABELS: Record<RiderApprovalStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  SUSPENDED: 'Suspended',
  REJECTED: 'Rejected',
};

const AVAILABILITY_LABELS: Record<RiderAvailability, string> = {
  OFFLINE: 'Offline',
  AVAILABLE: 'Available',
  BUSY: 'On a delivery',
};

export function readRiderOnboarding(value: unknown): RiderOnboarding {
  if (!isRecord(value)) {
    throw new Error('Rider status could not be loaded.');
  }
  const licenceVerificationStatus = licenceStatus(value.licenceVerificationStatus);
  const approvalStatus = approvalStatusOf(value.approvalStatus);
  const availability = availabilityOf(value.availability);
  if (!licenceVerificationStatus || !approvalStatus || !availability) {
    throw new Error('Rider status could not be loaded.');
  }
  if (!isNullableText(value.licenceNumber) || !isNullableText(value.licenceClass) || !isNullableText(value.rejectionReason)) {
    throw new Error('Rider status could not be loaded.');
  }
  if (!isCount(value.verifiedMotorcycleCount) || typeof value.activeVerifiedMotorcycle !== 'boolean') {
    throw new Error('Rider status could not be loaded.');
  }
  return {
    licenceVerificationStatus,
    approvalStatus,
    availability,
    licenceNumber: value.licenceNumber,
    licenceClass: value.licenceClass,
    rejectionReason: value.rejectionReason,
    verifiedMotorcycleCount: value.verifiedMotorcycleCount,
    activeVerifiedMotorcycle: value.activeVerifiedMotorcycle,
  };
}

export function riderReadiness(onboarding: RiderOnboarding): RiderReadiness {
  const approved = onboarding.approvalStatus === 'APPROVED';
  const availability = approved ? onboarding.availability : 'OFFLINE';
  return {
    canAcceptDeliveries: false,
    availabilityLabel: AVAILABILITY_LABELS[availability],
    licenceLabel: LICENCE_LABELS[onboarding.licenceVerificationStatus],
    approvalLabel: APPROVAL_LABELS[onboarding.approvalStatus],
    message: readinessMessage(onboarding, availability),
  };
}

function readinessMessage(onboarding: RiderOnboarding, availability: RiderAvailability): string {
  if (onboarding.approvalStatus === 'REJECTED') {
    return 'Your rider application was not approved. You cannot accept deliveries.';
  }
  if (onboarding.approvalStatus === 'SUSPENDED') {
    return 'Your rider account is suspended. You cannot accept deliveries.';
  }
  if (onboarding.approvalStatus !== 'APPROVED') {
    return 'Your account is waiting for approval. You cannot accept deliveries yet.';
  }
  if (onboarding.licenceVerificationStatus === 'REJECTED') {
    return onboarding.rejectionReason
      ? `Your licence was rejected: ${onboarding.rejectionReason}`
      : 'Your licence was not verified. You cannot accept deliveries yet.';
  }
  if (onboarding.licenceVerificationStatus !== 'VERIFIED') {
    return 'Your licence is still being reviewed. You cannot accept deliveries yet.';
  }
  if (!onboarding.activeVerifiedMotorcycle) {
    return 'You need an active verified motorcycle before you can accept deliveries.';
  }
  if (availability === 'BUSY') {
    return 'You are on a delivery. You cannot change availability until it is finished.';
  }
  if (availability !== 'AVAILABLE') {
    return 'Your account is approved. You are offline, so you cannot accept deliveries yet.';
  }
  return 'You are online. Your location is shared so customers nearby can find you. Delivery requests are not open in this version yet.';
}

function licenceStatus(value: unknown): LicenceVerificationStatus | null {
  return value === 'PENDING' || value === 'VERIFIED' || value === 'REJECTED' ? value : null;
}

function approvalStatusOf(value: unknown): RiderApprovalStatus | null {
  return value === 'PENDING' || value === 'APPROVED' || value === 'SUSPENDED' || value === 'REJECTED' ? value : null;
}

function availabilityOf(value: unknown): RiderAvailability | null {
  return value === 'OFFLINE' || value === 'AVAILABLE' || value === 'BUSY' ? value : null;
}

function isNullableText(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
