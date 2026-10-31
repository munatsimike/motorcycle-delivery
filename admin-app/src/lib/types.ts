export type Page<T> = {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type DashboardSummary = {
  deliveries: {
    total: number;
    active: number;
    completed: number;
    cancelled: number;
    byStatus: Record<string, number>;
    last24Hours: number;
  };
  riders: {
    total: number;
    pending: number;
    approved: number;
    suspended: number;
    rejected: number;
    availability: { offline: number; available: number; busy: number };
  };
  customers: {
    total: number;
    individual: number;
    business: number;
    last24Hours: number;
  };
  motorcycles: {
    total: number;
    pending: number;
    verified: number;
    rejected: number;
    revoked: number;
  };
};

export type CustomerRow = {
  customerAccountId: string;
  name: string;
  fullName: string;
  contactName: string | null;
  phone: string;
  accountStatus: string;
  kind: string;
  address: string;
  createdAt: string;
};

export type RiderRow = {
  riderProfileId: string;
  fullName: string;
  phone: string;
  accountStatus: string;
  verificationStatus: string;
  approvalStatus: string;
  availability: string;
  createdAt: string;
};

export type RiderDetail = {
  riderProfileId: string;
  fullName: string;
  phone: string;
  email: string | null;
  accountStatus: string;
  verificationStatus: string;
  approvalStatus: string;
  availability: string;
  licenceNumber: string | null;
  licenceClass: string | null;
  verifiedAt: string | null;
  licenceImage: { id: string; uploadedAt: string; contentType: string } | null;
  motorcycles: MotorcycleRow[];
  createdAt: string;
  updatedAt: string;
};

export type MotorcycleRow = {
  id: string;
  riderProfileId?: string;
  registrationNumber: string;
  make: string;
  model: string;
  colour: string;
  verificationStatus: string;
  isActive: boolean;
  createdAt?: string;
  rider?: { fullName: string; phone: string };
};

export type DeliveryRow = {
  deliveryId: string;
  deliveryType: string;
  status: string;
  pickupAddress: string;
  dropoffAddress: string;
  price: string;
  currency: string;
  paymentMethod: string | null;
  activeAssignment: { id: string; riderProfileId: string; motorcycleId: string; status: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminBid = {
  id: string;
  riderProfileId: string;
  riderName: string;
  amount: string;
  currency: string;
  status: string;
  closedAt: string | null;
  createdAt: string;
  accepted: boolean;
};

export type AdminReservation = {
  id: string;
  assignmentId: string | null;
  amount: string;
  currency: string;
  status: string;
  createdAt: string;
  releasedAt: string | null;
  capturedAt: string | null;
};

export type AdminAcceptance = {
  assignmentId: string;
  assignmentStatus: string;
  riderProfileId: string;
  riderName: string;
  acceptedBidId: string | null;
  acceptedAt: string | null;
  bidAmount: string | null;
  currency: string;
  basisPoints: number | null;
  rateVersion: number | null;
  commissionAmount: string | null;
  reservation: AdminReservation | null;
  commissionState: 'RESERVED' | 'CAPTURED' | 'RELEASED' | 'NOT_RESERVED' | 'UNRECORDED';
};

export type DeliveryDetail = Omit<DeliveryRow, 'price'> & {
  price: string | null;
  parcelSize: string | null;
  suggestedPrice: string | null;
  distanceMeters: number | null;
  pricingVersion: number | null;
  payer: string | null;
  serviceClass: string | null;
  deliverBy: string | null;
  assignments: Array<{
    id: string;
    riderProfileId: string;
    riderName: string;
    motorcycleId: string | null;
    status: string;
    offerExpiresAt: string | null;
    respondedAt: string | null;
    releaseReason: string | null;
    releasedAt: string | null;
    createdAt: string;
  }>;
  statusTimeline: Array<{
    id: string;
    previousStatus: string | null;
    newStatus: string;
    actorType: string;
    occurredAt: string;
  }>;
  bids: AdminBid[];
  acceptances: AdminAcceptance[];
  unmatchedReservations: AdminReservation[];
};

export type RiderWalletSummary = {
  riderProfileId: string;
  balance: string;
  borrowingLimit: string;
  borrowingLimitSource: 'DEFAULT' | 'OVERRIDE';
  reservedFees: string;
  availableCapacity: string;
  currency: string;
};

export type WalletConfig = {
  configVersion: number;
  currency: string;
  welcomeBonus: string;
  defaultBorrowingLimit: string;
  platformFee: string;
};

export type PricingModel = 'FIXED' | 'PER_KILOMETRE' | 'BASE_PLUS_PER_KILOMETRE' | 'DISTANCE_TIERS' | 'INCLUDED_DISTANCE';

export type ServiceClassName = 'EXPRESS' | 'FLEXIBLE';

export type PricingWindowKind = 'PEAK' | 'OFF_PEAK' | 'NIGHT';

export type DistanceTier = {
  id: string;
  position: number;
  upToMetres: number | null;
  amount: string;
};

export type PricingWindow = {
  id: string;
  kind: PricingWindowKind;
  enabled: boolean;
  daysOfWeek: number[];
  startsAt: string;
  endsAt: string;
  adjustmentBasisPoints: number;
  createdAt: string;
};

export type ClassTariff = {
  serviceClass: ServiceClassName;
  pricingVersion: number;
  pricingModel: PricingModel;
  currency: string;
  baseFee: string;
  pricePerKilometre: string;
  minimumTripMetres: number;
  maximumTripMetres: number;
  includedMetres: number | null;
  isActive: boolean;
  tiers: DistanceTier[];
  windows: PricingWindow[];
};

export type PricingAudit = {
  id: string;
  actorId: string;
  previousVersion: number | null;
  nextVersion: number | null;
  createdAt: string;
};

export type V2CommissionRate =
  | { configured: false }
  | {
      configured: true;
      basisPoints: number;
      percentage: string;
      rateVersion: number;
      createdById: string;
      createdAt: string;
    };

export type V2CommissionAudit = {
  id: string;
  actorId: string;
  previousVersion: number | null;
  nextVersion: number;
  previousBasisPoints: number | null;
  nextBasisPoints: number;
  previousPercentage: string | null;
  nextPercentage: string;
  createdAt: string;
};
