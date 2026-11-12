import type { Prisma } from '../generated/prisma/client.js';
import { riderClassFromStats } from './rider-class.js';

export async function recordSuccessfulDelivery(
  tx: Prisma.TransactionClient,
  profile: { id: string; completedDeliveryCount: number; ratingCount: number; ratingSum: number },
): Promise<void> {
  const completedDeliveryCount = profile.completedDeliveryCount + 1;
  await tx.riderProfile.update({
    where: { id: profile.id },
    data: {
      completedDeliveryCount,
      riderClass: riderClassFromStats(completedDeliveryCount, profile.ratingCount, profile.ratingSum),
    },
  });
}

export async function recordRiderRating(
  tx: Prisma.TransactionClient,
  profile: { id: string; completedDeliveryCount: number; ratingCount: number; ratingSum: number },
  stars: number,
): Promise<{ ratingCount: number; ratingSum: number; riderClass: ReturnType<typeof riderClassFromStats> }> {
  const ratingCount = profile.ratingCount + 1;
  const ratingSum = profile.ratingSum + stars;
  const riderClass = riderClassFromStats(profile.completedDeliveryCount, ratingCount, ratingSum);
  await tx.riderProfile.update({
    where: { id: profile.id },
    data: { ratingCount, ratingSum, riderClass },
  });
  return { ratingCount, ratingSum, riderClass };
}
