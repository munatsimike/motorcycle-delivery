import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, V2OutboxEventType, V2OutboxStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const FAILURE_CODE = /^[a-z_]{1,40}$/;

@Injectable()
export class AdminNoticeService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: Record<string, unknown>) {
    const page = readInteger(query.page, 1, 1, 100000);
    const limit = readInteger(query.limit, 20, 1, 100);
    const status = readEnum(query.status, V2OutboxStatus, 'Invalid notification status');
    const eventType = readEnum(query.eventType, V2OutboxEventType, 'Invalid notification type');
    const from = readInstant(query.from, 'from');
    const to = readInstant(query.to, 'to');
    if (from && to && from.getTime() > to.getTime()) {
      throw new BadRequestException('Invalid notification date');
    }
    const where: Prisma.V2OutboxEventWhereInput = {
      ...(status ? { status } : {}),
      ...(eventType ? { eventType } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.v2OutboxEvent.count({ where }),
      this.prisma.v2OutboxEvent.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          eventType: true,
          status: true,
          attemptCount: true,
          lastFailure: true,
          deliveryId: true,
          createdAt: true,
          lastAttemptAt: true,
          sentAt: true,
          failedAt: true,
          nextAttemptAt: true,
        },
      }),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        eventType: row.eventType,
        status: row.status,
        attemptCount: row.attemptCount,
        lastFailure: safeFailure(row.lastFailure),
        deliveryId: row.deliveryId,
        createdAt: row.createdAt,
        lastAttemptAt: row.lastAttemptAt,
        sentAt: row.sentAt,
        failedAt: row.failedAt,
        nextAttemptAt: row.nextAttemptAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

function safeFailure(value: string | null): string | null {
  if (!value || !FAILURE_CODE.test(value)) {
    return null;
  }
  return value;
}

function readEnum<T extends Record<string, string>>(
  value: unknown,
  values: T,
  message: string,
): T[keyof T] | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  if (typeof value !== 'string' || !Object.values(values).includes(value)) {
    throw new BadRequestException(message);
  }
  return value as T[keyof T];
}

function readInstant(value: unknown, bound: 'from' | 'to'): Date | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  if (typeof value !== 'string' || value.length > 40) {
    throw new BadRequestException('Invalid notification date');
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const start = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException('Invalid notification date');
    }
    if (bound === 'from') {
      return start;
    }
    return new Date(`${value}T23:59:59.999Z`);
  }
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime()) || instant.toISOString() !== value) {
    throw new BadRequestException('Invalid notification date');
  }
  return instant;
}

function readInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (
    typeof value !== 'string'
    || !/^[0-9]+$/.test(value)
    || !Number.isSafeInteger(Number(value))
    || Number(value) < min
    || Number(value) > max
  ) {
    throw new BadRequestException('Invalid pagination parameter');
  }
  return Number(value);
}
