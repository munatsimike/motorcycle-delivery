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
  paymentMethod: string;
  activeAssignment: { id: string; riderProfileId: string; motorcycleId: string; status: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type DeliveryDetail = DeliveryRow & {
  parcelSize: string | null;
  suggestedPrice: string | null;
  distanceMeters: number | null;
  pricingVersion: number | null;
  payer: string | null;
  assignments: Array<{
    id: string;
    riderProfileId: string;
    motorcycleId: string;
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
};

export type WalletConfig = {
  configVersion: number;
  currency: string;
  welcomeBonus: string;
  defaultBorrowingLimit: string;
  platformFee: string;
};

export type DeliveryPricing = {
  pricingVersion: number;
  currency: string;
  baseFee: string;
  pricePerKilometre: string;
  minimumTripMetres: number;
  maximumTripMetres: number;
};

export type CommissionPolicy = {
  model: 'ON_COMPLETION' | 'ON_ACCEPTANCE';
  policyVersion: number;
};
