const SCALE = 10_000n;
const HALF = 5_000n;

export class CommissionCalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommissionCalculationError';
  }
}

export type V2CommissionSnapshot = {
  acceptedBidCents: number;
  basisPoints: number;
  rateVersion: number;
  commissionCents: number;
};

// Commission is the accepted bid multiplied by the published basis points.
// The suggested delivery price is not an input.
export function commissionCents(bidCents: number, basisPoints: number): number {
  assertWholeCents(bidCents, 'Enter the accepted bid in cents');
  assertBasisPoints(basisPoints);
  const rounded = (BigInt(bidCents) * BigInt(basisPoints) + HALF) / SCALE;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new CommissionCalculationError('Commission amount is too large');
  }
  return Number(rounded);
}

export function snapshotCommission(input: {
  acceptedBidCents: number;
  basisPoints: number;
  rateVersion: number;
}): V2CommissionSnapshot {
  if (!Number.isSafeInteger(input.rateVersion) || input.rateVersion < 1) {
    throw new CommissionCalculationError('Enter a published commission rate version');
  }
  return Object.freeze({
    acceptedBidCents: input.acceptedBidCents,
    basisPoints: input.basisPoints,
    rateVersion: input.rateVersion,
    commissionCents: commissionCents(input.acceptedBidCents, input.basisPoints),
  });
}

function assertWholeCents(value: number, message: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new CommissionCalculationError(message);
  }
}

function assertBasisPoints(value: number) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new CommissionCalculationError('Enter a commission percentage from 0 to 100');
  }
}
