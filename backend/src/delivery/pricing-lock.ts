import type { Prisma } from '../generated/prisma/client.js';

export const activeV1PricingWhere = { isActive: true, serviceClass: null } as const;

export async function lockActivePricing(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`
    SELECT "id" FROM "delivery_pricing_configs"
    WHERE "is_active" = true AND "service_class" IS NULL
    FOR UPDATE
  `;
  return tx.deliveryPricingConfig.findFirst({ where: activeV1PricingWhere });
}

export async function lockPricingPublication(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(724311, 2)::text AS lock_result
  `;
}

export async function lockActiveClassPricing(tx: Prisma.TransactionClient, serviceClass: 'EXPRESS' | 'FLEXIBLE') {
  await tx.$queryRaw`
    SELECT "id" FROM "delivery_pricing_configs"
    WHERE "is_active" = true AND "service_class" = ${serviceClass}::"service_class"
    FOR UPDATE
  `;
}

export async function allocatePricingVersion(tx: Prisma.TransactionClient): Promise<number> {
  await tx.$queryRaw`
    SELECT "pricing_version" FROM "delivery_pricing_configs"
    ORDER BY "pricing_version" DESC
    LIMIT 1
    FOR UPDATE
  `;
  const highest = await tx.deliveryPricingConfig.findFirst({
    orderBy: { pricingVersion: 'desc' },
    select: { pricingVersion: true },
  });
  return (highest?.pricingVersion ?? 0) + 1;
}
