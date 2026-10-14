import type { Prisma } from '../generated/prisma/client.js';

export async function lockActivePricing(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`
    SELECT "id" FROM "delivery_pricing_configs" WHERE "is_active" = true FOR UPDATE
  `;
  return tx.deliveryPricingConfig.findFirst({ where: { isActive: true } });
}
