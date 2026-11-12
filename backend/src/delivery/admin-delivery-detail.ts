import { centsFromDecimal, formatCents } from './money.js';

export type AdminCommissionState =
  | 'RESERVED'
  | 'CAPTURED'
  | 'RELEASED'
  | 'NOT_RESERVED'
  | 'UNRECORDED';

type NamedRider = {
  user: { fullName: string };
};

type AssignmentSource = {
  id: string;
  riderProfileId: string;
  motorcycleId: string | null;
  status: string;
  offerExpiresAt: Date | null;
  respondedAt: Date | null;
  releaseReason: string | null;
  releasedAt: Date | null;
  createdAt: Date;
  serviceClass: string | null;
  acceptedBidAmount: unknown;
  acceptedCommissionBasisPoints: number | null;
  acceptedV2CommissionRateVersion: number | null;
  acceptedCommissionAmount: unknown;
  acceptedBidId: string | null;
  riderProfile: NamedRider;
};

type BidSource = {
  id: string;
  riderProfileId: string;
  amount: unknown;
  currency: string;
  status: string;
  closedAt: Date | null;
  createdAt: Date;
  riderProfile: NamedRider;
};

type ReservationSource = {
  id: string;
  assignmentId: string | null;
  amount: unknown;
  currency: string;
  status: string;
  createdAt: Date;
  releasedAt: Date | null;
  capturedAt: Date | null;
};

export type AdminDeliverySource = {
  id: string;
  deliveryType: string;
  status: string;
  pickupAddress: string;
  dropoffAddress: string;
  parcelSize: string | null;
  price: unknown;
  suggestedPrice: unknown;
  distanceMeters: number | null;
  pricingVersion: number | null;
  payer: string | null;
  currency: string;
  paymentMethod: string | null;
  serviceClass: string | null;
  deliverBy: Date | null;
  createdAt: Date;
  updatedAt: Date;
  statusEvents: Array<{
    id: string;
    previousStatus: string | null;
    newStatus: string;
    actorType: string;
    occurredAt: Date;
  }>;
  assignments: AssignmentSource[];
  bids: BidSource[];
  feeReservations: ReservationSource[];
};

export const ADMIN_DELIVERY_DETAIL_SELECT = {
  id: true,
  deliveryType: true,
  status: true,
  pickupAddress: true,
  dropoffAddress: true,
  parcelSize: true,
  price: true,
  suggestedPrice: true,
  distanceMeters: true,
  pricingVersion: true,
  payer: true,
  currency: true,
  paymentMethod: true,
  serviceClass: true,
  deliverBy: true,
  createdAt: true,
  updatedAt: true,
  statusEvents: {
    orderBy: [{ occurredAt: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      previousStatus: true,
      newStatus: true,
      actorType: true,
      occurredAt: true,
    },
  },
  assignments: {
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    select: {
      id: true,
      riderProfileId: true,
      motorcycleId: true,
      status: true,
      offerExpiresAt: true,
      respondedAt: true,
      releaseReason: true,
      releasedAt: true,
      createdAt: true,
      serviceClass: true,
      acceptedBidAmount: true,
      acceptedCommissionBasisPoints: true,
      acceptedV2CommissionRateVersion: true,
      acceptedCommissionAmount: true,
      acceptedBidId: true,
      riderProfile: { select: { user: { select: { fullName: true } } } },
    },
  },
  bids: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      riderProfileId: true,
      amount: true,
      currency: true,
      status: true,
      closedAt: true,
      createdAt: true,
      riderProfile: { select: { user: { select: { fullName: true } } } },
    },
  },
  feeReservations: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      assignmentId: true,
      amount: true,
      currency: true,
      status: true,
      createdAt: true,
      releasedAt: true,
      capturedAt: true,
    },
  },
};

export function toAdminDeliveryDetail(delivery: AdminDeliverySource) {
  const assignments = [...delivery.assignments].sort((left, right) => {
    const difference = right.createdAt.getTime() - left.createdAt.getTime();
    if (difference !== 0) return difference;
    if (left.id > right.id) return -1;
    if (left.id < right.id) return 1;
    return 0;
  });
  const reservations = [...delivery.feeReservations]
    .sort((left, right) => compareTime(left.createdAt, right.createdAt, left.id, right.id))
    .map(toReservation);
  const reservationByAssignment = new Map(reservations.flatMap((reservation) =>
    reservation.assignmentId ? [[reservation.assignmentId, reservation] as const] : [],
  ));
  const assignmentViews = assignments.map((assignment) => ({
    id: assignment.id,
    riderProfileId: assignment.riderProfileId,
    riderName: assignment.riderProfile.user.fullName,
    motorcycleId: assignment.motorcycleId,
    status: assignment.status,
    offerExpiresAt: assignment.offerExpiresAt,
    respondedAt: assignment.respondedAt,
    releaseReason: assignment.releaseReason,
    releasedAt: assignment.releasedAt,
    createdAt: assignment.createdAt,
  }));
  const acceptances = assignments
    .filter((assignment) => assignment.acceptedBidId !== null || assignment.acceptedBidAmount !== null)
    .sort((left, right) => compareTime(left.respondedAt, right.respondedAt, left.id, right.id))
    .map((assignment) => {
      const commissionAmount = money(assignment.acceptedCommissionAmount);
      const reservation = reservationByAssignment.get(assignment.id) ?? null;
      return {
        assignmentId: assignment.id,
        assignmentStatus: assignment.status,
        riderProfileId: assignment.riderProfileId,
        riderName: assignment.riderProfile.user.fullName,
        acceptedBidId: assignment.acceptedBidId,
        acceptedAt: assignment.respondedAt,
        bidAmount: money(assignment.acceptedBidAmount),
        currency: delivery.currency,
        basisPoints: assignment.acceptedCommissionBasisPoints,
        rateVersion: assignment.acceptedV2CommissionRateVersion,
        commissionAmount,
        reservation,
        commissionState: commissionState(commissionAmount, reservation?.status ?? null),
      };
    });
  const matchedReservationIds = new Set(
    acceptances.flatMap((acceptance) => acceptance.reservation ? [acceptance.reservation.id] : []),
  );

  return {
    deliveryId: delivery.id,
    deliveryType: delivery.deliveryType,
    status: delivery.status,
    pickupAddress: delivery.pickupAddress,
    dropoffAddress: delivery.dropoffAddress,
    parcelSize: delivery.parcelSize,
    price: delivery.price,
    suggestedPrice: delivery.suggestedPrice,
    distanceMeters: delivery.distanceMeters,
    pricingVersion: delivery.pricingVersion,
    payer: delivery.payer,
    currency: delivery.currency,
    paymentMethod: delivery.paymentMethod,
    serviceClass: delivery.serviceClass,
    deliverBy: delivery.deliverBy,
    createdAt: delivery.createdAt,
    updatedAt: delivery.updatedAt,
    activeAssignment: assignmentViews.find((assignment) => assignment.status === 'ACCEPTED') ?? null,
    assignments: assignmentViews,
    statusTimeline: [...delivery.statusEvents].sort((left, right) =>
      compareTime(left.occurredAt, right.occurredAt, left.id, right.id),
    ),
    bids: [...delivery.bids]
      .sort((left, right) => compareTime(left.createdAt, right.createdAt, left.id, right.id))
      .map((bid) => ({
        id: bid.id,
        riderProfileId: bid.riderProfileId,
        riderName: bid.riderProfile.user.fullName,
        amount: money(bid.amount),
        currency: bid.currency,
        status: bid.status,
        closedAt: bid.closedAt,
        createdAt: bid.createdAt,
        accepted: bid.status === 'ACCEPTED',
      })),
    acceptances,
    unmatchedReservations: reservations.filter((reservation) => !matchedReservationIds.has(reservation.id)),
  };
}

function toReservation(reservation: ReservationSource) {
  return {
    id: reservation.id,
    assignmentId: reservation.assignmentId,
    amount: money(reservation.amount),
    currency: reservation.currency,
    status: reservation.status,
    createdAt: reservation.createdAt,
    releasedAt: reservation.releasedAt,
    capturedAt: reservation.capturedAt,
  };
}

function commissionState(amount: string | null, status: string | null): AdminCommissionState {
  if (status === 'OPEN') return 'RESERVED';
  if (status === 'CAPTURED') return 'CAPTURED';
  if (status === 'RELEASED') return 'RELEASED';
  if (amount === '0.00') return 'NOT_RESERVED';
  return 'UNRECORDED';
}

function money(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return formatCents(centsFromDecimal(value as string | { toFixed(digits: number): string }));
}

function compareTime(left: Date | null, right: Date | null, leftId: string, rightId: string): number {
  if (left && right) {
    const difference = left.getTime() - right.getTime();
    if (difference !== 0) return difference;
  } else if (left) {
    return -1;
  } else if (right) {
    return 1;
  }
  if (leftId < rightId) return -1;
  if (leftId > rightId) return 1;
  return 0;
}
