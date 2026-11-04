import { RiderClass } from '../generated/prisma/client.js';

export function riderClassFromStats(
  completedDeliveries: number,
  ratingCount: number,
  ratingSum: number,
): RiderClass {
  const average = ratingCount > 0 ? ratingSum / ratingCount : 0;
  if (completedDeliveries >= 200 && ratingCount >= 10 && average >= 4.8) {
    return RiderClass.PLATINUM;
  }
  if (completedDeliveries >= 50 && ratingCount >= 10 && average >= 4.5) {
    return RiderClass.GOLD;
  }
  return RiderClass.SILVER;
}

export function averageRating(ratingCount: number, ratingSum: number): number | null {
  if (ratingCount <= 0) {
    return null;
  }
  return Math.round((ratingSum / ratingCount) * 10) / 10;
}
