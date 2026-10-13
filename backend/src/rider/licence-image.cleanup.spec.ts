import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LicenceImageStatus } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { LicenceImageCleanup } from './licence-image.cleanup.js';
import type { ObjectStorage } from './object-storage.js';

const NOW = new Date('2026-10-13T12:00:00.000Z');

describe('LicenceImageCleanup', () => {
  afterEach(() => {
    delete process.env.LICENCE_STORAGE_SECRET_ACCESS_KEY;
    vi.restoreAllMocks();
  });

  it('retries a failed delete and marks the row purged only after deletion succeeds', async () => {
    process.env.LICENCE_STORAGE_SECRET_ACCESS_KEY = 'storage-secret-value';
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const images = [
      image('abandoned', LicenceImageStatus.UPLOADING, new Date(NOW.getTime() - 2 * 60 * 60 * 1000), null),
      image('due', LicenceImageStatus.SUPERSEDED, new Date(NOW.getTime() - 100 * 24 * 60 * 60 * 1000), new Date(NOW.getTime() - 1000)),
      image('kept', LicenceImageStatus.SUPERSEDED, NOW, new Date(NOW.getTime() + 24 * 60 * 60 * 1000)),
      image('fresh', LicenceImageStatus.UPLOADING, NOW, null),
    ];
    const failures = new Set(['riders/profile-1/licences/abandoned', 'riders/profile-1/licences/due']);
    const deleted: string[] = [];
    const storage = {
      put: vi.fn(async () => undefined),
      delete: vi.fn(async (key: string) => {
        deleted.push(key);
        if (failures.has(key)) {
          failures.delete(key);
          const error = new Error('delete failed storage-secret-value');
          error.name = 'ServiceException';
          throw Object.assign(error, { $metadata: { httpStatusCode: 503 } });
        }
      }),
    };
    const cleanup = new LicenceImageCleanup(database(images) as unknown as PrismaService, storage as unknown as ObjectStorage, {} as never);

    await cleanup.run(NOW);
    expect(status(images, 'abandoned')).toBe(LicenceImageStatus.PURGE_PENDING);
    expect(status(images, 'due')).toBe(LicenceImageStatus.SUPERSEDED);
    expect(images.find((row) => row.id === 'due')?.purgedAt).toBeNull();
    expect(status(images, 'kept')).toBe(LicenceImageStatus.SUPERSEDED);
    expect(status(images, 'fresh')).toBe(LicenceImageStatus.UPLOADING);
    expect(warn.mock.calls.map((call) => String(call[0])).join('\n')).not.toContain('storage-secret-value');

    await cleanup.run(NOW);
    expect(status(images, 'abandoned')).toBe(LicenceImageStatus.PURGED);
    expect(status(images, 'due')).toBe(LicenceImageStatus.PURGED);
    expect(images.find((row) => row.id === 'abandoned')?.purgedAt).toEqual(NOW);

    const calls = deleted.length;
    await cleanup.run(NOW);
    expect(deleted).toHaveLength(calls);
    expect(status(images, 'kept')).toBe(LicenceImageStatus.SUPERSEDED);
  });
});

type ImageRow = {
  id: string;
  objectKey: string;
  status: LicenceImageStatus;
  createdAt: Date;
  purgeAfter: Date | null;
  purgedAt: Date | null;
};

function image(id: string, status: LicenceImageStatus, createdAt: Date, purgeAfter: Date | null): ImageRow {
  return {
    id,
    objectKey: `riders/profile-1/licences/${id}`,
    status,
    createdAt,
    purgeAfter,
    purgedAt: null,
  };
}

function status(images: ImageRow[], id: string): LicenceImageStatus | undefined {
  return images.find((row) => row.id === id)?.status;
}

function database(images: ImageRow[]) {
  const matches = (row: ImageRow, where: Record<string, unknown>): boolean => {
    if (typeof where.status === 'string' && row.status !== where.status) return false;
    const createdAt = where.createdAt as { lt?: Date } | undefined;
    if (createdAt?.lt && !(row.createdAt < createdAt.lt)) return false;
    const purgeAfter = where.purgeAfter as { lte?: Date } | undefined;
    if (purgeAfter?.lte && (!row.purgeAfter || row.purgeAfter > purgeAfter.lte)) return false;
    if (typeof where.id === 'string' && row.id !== where.id) return false;
    return true;
  };
  return {
    riderLicenceImage: {
      async updateMany({ where, data }: { where: Record<string, unknown>; data: Partial<ImageRow> }) {
        const or = where.OR as Record<string, unknown>[] | undefined;
        const matched = images.filter((row) => or ? or.some((branch) => matches(row, branch)) : matches(row, where));
        for (const row of matched) {
          Object.assign(row, data);
        }
        return { count: matched.length };
      },
      async findMany({ where }: { where: { OR: Record<string, unknown>[] } }) {
        return images.filter((row) => where.OR.some((branch) => matches(row, branch)));
      },
    },
  };
}
