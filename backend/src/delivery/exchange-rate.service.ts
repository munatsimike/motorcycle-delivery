import { ConflictException, Injectable } from '@nestjs/common';
import type { AdminContext } from '../auth/admin-access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { formatZigPerUsd, readZigPerUsd, zigPerUsdUnits } from './exchange-rate.js';

type StoredRate = {
  id: string;
  rateVersion: number;
  zigPerUsd: string | { toFixed(digits: number): string };
  createdById: string | null;
  createdAt: Date;
};

@Injectable()
export class ExchangeRateService {
  constructor(private readonly prisma: PrismaService) {}

  async current(): Promise<ExchangeRateView> {
    const active = await this.prisma.exchangeRate.findFirst({ where: { isActive: true } });
    if (!active) {
      throw new ConflictException('An exchange rate has not been published');
    }
    return toView(active);
  }

  async publish(admin: AdminContext, body: unknown, now = new Date()): Promise<ExchangeRateView> {
    const next = readZigPerUsd(body);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(724311, 4)::text AS lock_result`;
      const active = await tx.exchangeRate.findFirst({ where: { isActive: true } });
      if (active && zigPerUsdUnits(active.zigPerUsd) === next.units) {
        return toView(active);
      }
      if (active) {
        await tx.exchangeRate.update({ where: { id: active.id }, data: { isActive: false } });
      }
      const highest = await tx.exchangeRate.findFirst({ orderBy: { rateVersion: 'desc' } });
      const rateVersion = (highest?.rateVersion ?? 0) + 1;
      const created = await tx.exchangeRate.create({
        data: {
          rateVersion,
          zigPerUsd: next.text,
          isActive: true,
          createdById: admin.userId,
          createdAt: now,
        },
      });
      await tx.exchangeRateAudit.create({
        data: {
          actorId: admin.userId,
          previousVersion: active?.rateVersion ?? null,
          nextVersion: rateVersion,
          previousZigPerUsd: active ? formatZigPerUsd(zigPerUsdUnits(active.zigPerUsd)) : null,
          nextZigPerUsd: next.text,
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
      this.prisma.exchangeRateAudit.count(),
      this.prisma.exchangeRateAudit.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          actorId: true,
          previousVersion: true,
          nextVersion: true,
          previousZigPerUsd: true,
          nextZigPerUsd: true,
          createdAt: true,
          actor: { select: { fullName: true } },
        },
      }),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        actorId: row.actorId,
        actorName: row.actor.fullName,
        previousVersion: row.previousVersion,
        nextVersion: row.nextVersion,
        previousZigPerUsd: row.previousZigPerUsd === null ? null : formatZigPerUsd(zigPerUsdUnits(row.previousZigPerUsd)),
        nextZigPerUsd: formatZigPerUsd(zigPerUsdUnits(row.nextZigPerUsd)),
        createdAt: row.createdAt.toISOString(),
      })),
      pagination: { page, limit, total, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    };
  }
}

export type ExchangeRateView = {
  rateVersion: number;
  zigPerUsd: string;
  usd: '1.00';
  createdById: string | null;
  createdAt: string;
};

function toView(row: StoredRate): ExchangeRateView {
  return {
    rateVersion: row.rateVersion,
    zigPerUsd: formatZigPerUsd(zigPerUsdUnits(row.zigPerUsd)),
    usd: '1.00',
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
  };
}

function readPage(value: unknown, fallback: number, max: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) return fallback;
  return parsed;
}
