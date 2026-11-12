import { MotorcycleVerificationStatus, Prisma } from '../generated/prisma/client.js';

// A rider should not have to choose a bike after approval. When none is
// active, the earliest verified motorcycle becomes the default. An existing
// active motorcycle is left as the rider selected it.
export async function ensureDefaultMotorcycle(
  tx: Prisma.TransactionClient,
  riderProfileId: string,
  now: Date,
): Promise<void> {
  const active = await tx.motorcycle.findFirst({
    where: { riderProfileId, isActive: true },
    select: { id: true },
  });
  if (active) {
    return;
  }

  const first = await tx.motorcycle.findFirst({
    where: {
      riderProfileId,
      verificationStatus: MotorcycleVerificationStatus.VERIFIED,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  if (!first) {
    return;
  }

  await tx.motorcycle.update({
    where: { id: first.id },
    data: { isActive: true, updatedAt: now },
  });
}
