import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AdminNoticeController } from './admin-notice.controller.js';
import { AdminNoticeService } from './admin-notice.service.js';

const createdAt = new Date('2026-10-04T12:00:00.000Z');

function service() {
  const calls: unknown[] = [];
  const prisma = {
    v2OutboxEvent: {
      async count(args: unknown) {
        calls.push(args);
        return 1;
      },
      async findMany() {
        return [{
          id: '018f5b2a-6c3d-7e4f-8a9b-0c1d2e3f4a5d',
          eventType: 'DELIVERED',
          status: 'FAILED',
          attemptCount: 3,
          lastFailure: 'provider_timeout',
          deliveryId: '018f5b2a-6c3d-7e4f-8a9b-0c1d2e3f4a5c',
          createdAt,
          lastAttemptAt: createdAt,
          sentAt: null,
          failedAt: createdAt,
          nextAttemptAt: null,
        }, {
          id: '018f5b2a-6c3d-7e4f-8a9b-0c1d2e3f4a5e',
          eventType: 'COLLECTED',
          status: 'FAILED',
          attemptCount: 1,
          lastFailure: 'token=secret',
          deliveryId: null,
          createdAt,
          lastAttemptAt: null,
          sentAt: null,
          failedAt: createdAt,
          nextAttemptAt: null,
        }];
      },
    },
  };
  return { notices: new AdminNoticeService(prisma as never), calls };
}

describe('AdminNoticeService', () => {
  it('filters by status and an inclusive created date', async () => {
    const { notices, calls } = service();
    const page = await notices.list({
      status: 'FAILED',
      eventType: 'DELIVERED',
      from: '2026-10-04',
      to: '2026-10-04',
      page: '1',
      limit: '20',
    });
    expect(calls[0]).toMatchObject({
      where: {
        status: 'FAILED',
        eventType: 'DELIVERED',
        createdAt: {
          gte: new Date('2026-10-04T00:00:00.000Z'),
          lte: new Date('2026-10-04T23:59:59.999Z'),
        },
      },
    });
    expect(page.data[0]).toMatchObject({ lastFailure: 'provider_timeout', sentAt: null, failedAt: createdAt });
    expect(page.data[1]).toMatchObject({ status: 'FAILED', lastFailure: null, lastAttemptAt: null });
    expect(JSON.stringify(page)).not.toContain('secret');
    expect(JSON.stringify(page)).not.toContain('claim');
  });

  it('rejects an unknown status, a reversed range, and an oversized page', async () => {
    const { notices } = service();
    await expect(notices.list({ status: 'RETRY' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(notices.list({ from: '2026-10-05', to: '2026-10-04' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(notices.list({ limit: '101' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AdminNoticeController', () => {
  it('requires an admin before reading the outbox', () => {
    const controller = new AdminNoticeController({
      async list() {
        throw new Error('should not read');
      },
    } as never);
    expect(() => controller.list({} as never, {})).toThrow('Admin access is required');
  });
});
