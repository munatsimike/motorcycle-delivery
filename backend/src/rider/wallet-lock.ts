import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';

export async function lockWalletOwner(tx: Prisma.TransactionClient, riderProfileId: string) {
  await tx.$queryRaw`
    SELECT "id" FROM "rider_profiles" WHERE "id" = CAST(${riderProfileId} AS uuid) FOR UPDATE
  `;
  const profile = await tx.riderProfile.findUnique({ where: { id: riderProfileId } });
  if (!profile) {
    throw new NotFoundException('Rider profile not found');
  }
  return profile;
}

export async function lockRiderWallet(tx: Prisma.TransactionClient, riderWalletId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT "id" FROM "rider_wallets" WHERE "id" = CAST(${riderWalletId} AS uuid) FOR UPDATE
  `;
}
