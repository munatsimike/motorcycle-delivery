import type { AdminAcceptance, DeliveryDetail } from './types';

export function agreedBidAmount(delivery: DeliveryDetail): string | null {
  const current = delivery.activeAssignment
    ? delivery.acceptances.find((acceptance) => acceptance.assignmentId === delivery.activeAssignment?.id)
    : undefined;
  return current?.bidAmount ?? null;
}

export function commissionPercent(basisPoints: number | null): string {
  if (basisPoints === null) return 'Rate not recorded';
  const whole = Math.trunc(basisPoints / 100);
  const fraction = Math.abs(basisPoints % 100);
  return `${whole}.${String(fraction).padStart(2, '0')}%`;
}

export function commissionStateLabel(state: AdminAcceptance['commissionState']): string {
  if (state === 'RESERVED') return 'Reserved at acceptance';
  if (state === 'CAPTURED') return 'Captured after delivery';
  if (state === 'RELEASED') return 'Released after cancellation';
  if (state === 'NOT_RESERVED') return 'No commission was reserved';
  return 'Commission reservation is not recorded';
}

export function commissionStateTime(acceptance: AdminAcceptance): string | null {
  const reservation = acceptance.reservation;
  if (!reservation) return null;
  if (acceptance.commissionState === 'CAPTURED') return reservation.capturedAt;
  if (acceptance.commissionState === 'RELEASED') return reservation.releasedAt;
  if (acceptance.commissionState === 'RESERVED') return reservation.createdAt;
  return null;
}
