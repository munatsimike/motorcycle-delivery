import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import type { AdminContext } from '../auth/admin-access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { percentageFromBasisPoints, readV2CommissionPercentage } from './v2-commission-rate.js';

type StoredRate = {
  rateVersion: number;
  basisPoints: number;
  createdById: string;
  createdAt: Date;
};

type RateView = {
  configured: true;
  basisPoints: number;
  percentage: string;
  rateVersion: number;
  createdById: string;
  createdAt: string;
};

@Injectable()
export class V2CommissionRateService {
  constructor(private readonly prisma: PrismaService) {}

  async current(): Promise<RateView | { configured: false }> {
    const active = await this.prisma.v2CommissionRate.findFirst({ where: { isActive: true } });
    return active ? toView(active) : { configured: false };
  }

  async publish(admin: AdminContext, body: unknown, now = new Date()): Promise<RateView> {
    const basisPoints = readV2CommissionPercentage(body);
    return this.prisma.$transaction(async (tx) => {
      await lockPublication(tx);
      const active = await tx.v2CommissionRate.findFirst({ where: { isActive: true } });
      if (active && active.basisPoints === basisPoints) {
        return toView(active);
      }
      if (active) {
        await tx.v2CommissionRate.update({
          where: { id: active.id },
          data: { isActive: false },
        });
      }
      const rateVersion = await allocateRateVersion(tx);
      const created = await tx.v2CommissionRate.create({
        data: {
          rateVersion,
          basisPoints,
          isActive: true,
          createdById: admin.userId,
          createdAt: now,
        },
      });
      await tx.v2CommissionRateAudit.create({
        data: {
          actorId: admin.userId,
          previousVersion: active?.rateVersion ?? null,
          nextVersion: rateVersion,
          previousBasisPoints: active?.basisPoints ?? null,
          nextBasisPoints: basisPoints,
          createdAt: now,
        },
      });
      return toView(created);
    });
  }

  async audits(query: Record<string, unknown>) {
    const page = readPage(query.page, 1, 100_000);
    const limit = readPage(query.limit, 20, 100);
    const [total, rows] = await Promise.all([
      this.prisma.v2CommissionRateAudit.count(),
      this.prisma.v2CommissionRateAudit.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        actorId: row.actorId,
        previousVersion: row.previousVersion,
        nextVersion: row.nextVersion,
        previousBasisPoints: row.previousBasisPoints,
        nextBasisPoints: row.nextBasisPoints,
        previousPercentage: row.previousBasisPoints === null ? null : percentageFromBasisPoints(row.previousBasisPoints),
        nextPercentage: percentageFromBasisPoints(row.nextBasisPoints),
        createdAt: row.createdAt.toISOString(),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }
}

async function lockPublication(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(724311, 3)::text AS lock_result
  `;
  await tx.$queryRaw`
    SELECT "rate_version" FROM "v2_commission_rates"
    ORDER BY "rate_version" DESC
    LIMIT 1
    FOR UPDATE
  `;
}

async function allocateRateVersion(tx: Prisma.TransactionClient): Promise<number> {
  const highest = await tx.v2CommissionRate.findFirst({
    orderBy: { rateVersion: 'desc' },
    select: { rateVersion: true },
  });
  return (highest?.rateVersion ?? 0) + 1;
}

function toView(row: StoredRate): RateView {
  return {
    configured: true,
    basisPoints: row.basisPoints,
    percentage: percentageFromBasisPoints(row.basisPoints),
    rateVersion: row.rateVersion,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
  };
}

function readPage(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) {
    return fallback;
  }
  const numeric = typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isInteger(numeric) || numeric < 1 || numeric > maximum) {
    throw new BadRequestException('Invalid pagination parameter');
  }
  return numeric;
}
