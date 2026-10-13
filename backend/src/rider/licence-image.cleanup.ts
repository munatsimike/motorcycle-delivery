import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { LicenceImageStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ABANDONED_UPLOAD_MS, cleanupIntervalMs } from './licence.constants.js';
import { ObjectStorage } from './object-storage.js';
import { logStorageFailure } from './storage-log.js';

@Injectable()
export class LicenceImageCleanup implements OnModuleInit, OnModuleDestroy {
  private readonly intervalName = 'licence-image-cleanup';

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorage,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const timer = setInterval(() => {
      void this.run().catch((error: unknown) => logStorageFailure(error));
    }, cleanupIntervalMs());
    timer.unref();
    this.scheduler.addInterval(this.intervalName, timer);
  }

  onModuleDestroy(): void {
    if (this.scheduler.doesExist('interval', this.intervalName)) {
      this.scheduler.deleteInterval(this.intervalName);
    }
  }

  async run(now = new Date()): Promise<void> {
    await this.prisma.riderLicenceImage.updateMany({
      where: {
        status: LicenceImageStatus.UPLOADING,
        createdAt: { lt: new Date(now.getTime() - ABANDONED_UPLOAD_MS) },
      },
      data: { status: LicenceImageStatus.PURGE_PENDING },
    });

    const due = await this.prisma.riderLicenceImage.findMany({
      where: {
        OR: [
          { status: LicenceImageStatus.PURGE_PENDING },
          { status: LicenceImageStatus.SUPERSEDED, purgeAfter: { lte: now } },
        ],
      },
    });

    for (const image of due) {
      try {
        await this.storage.delete(image.objectKey);
      } catch (error) {
        logStorageFailure(error);
        continue;
      }
      await this.prisma.riderLicenceImage.updateMany({
        where: { id: image.id, status: image.status },
        data: { status: LicenceImageStatus.PURGED, purgedAt: now },
      });
    }
  }
}
