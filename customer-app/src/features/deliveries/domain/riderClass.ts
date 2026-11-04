export const RIDER_CLASSES = ['SILVER', 'GOLD', 'PLATINUM'] as const;

export type RiderClassName = (typeof RIDER_CLASSES)[number];

export const riderClassColors: Record<RiderClassName, { text: string; background: string }> = {
  SILVER: { text: '#5C6770', background: '#EEF1F4' },
  GOLD: { text: '#9A6B12', background: '#FFF4D6' },
  PLATINUM: { text: '#3D4A66', background: '#E8EEF4' },
};

export function readRiderClass(value: unknown): RiderClassName {
  if (value === undefined || value === null) {
    return 'SILVER';
  }
  if (typeof value === 'string' && RIDER_CLASSES.includes(value as RiderClassName)) {
    return value as RiderClassName;
  }
  return 'SILVER';
}

export function riderClassLabel(value: RiderClassName): string {
  if (value === 'GOLD') {
    return 'Gold';
  }
  if (value === 'PLATINUM') {
    return 'Platinum';
  }
  return 'Silver';
}

export function riderRatingLine(input: {
  averageRating: number | null;
  ratingCount: number;
  completedDeliveries: number;
}): { rating: string | null; rides: string } {
  const rides = input.completedDeliveries === 1
    ? '1 ride'
    : `${input.completedDeliveries} rides`;
  if (input.ratingCount <= 0 || input.averageRating == null) {
    return { rating: null, rides };
  }
  return {
    rating: input.averageRating.toFixed(1),
    rides,
  };
}
