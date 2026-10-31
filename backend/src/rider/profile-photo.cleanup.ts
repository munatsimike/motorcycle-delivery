import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ProfilePhotoStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ObjectStorage } from './object-storage.js';
import { PROFILE_PHOTO_ABANDONED_UPLOAD_MS, profilePhotoCleanupIntervalMs } from './profile-photo.constants.js';
import { logStorageFailure } from './storage-log.js';

@Injectable()
export class ProfilePhotoCleanup implements OnModuleInit, OnModuleDestroy {
  private readonly intervalName = 'profile-photo-cleanup';

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorage,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const timer = setInterval(() => {
      void this.run().catch((error: unknown) => logStorageFailure(error, 'Profile photo'));
    }, profilePhotoCleanupIntervalMs());
    timer.unref();
    this.scheduler.addInterval(this.intervalName, timer);
  }

  onModuleDestroy(): void {
    if (this.scheduler.doesExist('interval', this.intervalName)) {
      this.scheduler.deleteInterval(this.intervalName);
    }
  }

  async run(now = new Date()): Promise<void> {
    await this.retire(this.prisma.riderProfilePhoto, now);
    await this.retire(this.prisma.customerProfilePhoto, now);
  }

  private async retire(
    photos: {
      updateMany(args: unknown): Promise<unknown>;
      findMany(args: unknown): Promise<Array<{ id: string; objectKey: string; status: ProfilePhotoStatus }>>;
    },
    now: Date,
  ): Promise<void> {
    await photos.updateMany({
      where: {
        status: ProfilePhotoStatus.UPLOADING,
        createdAt: { lt: new Date(now.getTime() - PROFILE_PHOTO_ABANDONED_UPLOAD_MS) },
      },
      data: { status: ProfilePhotoStatus.PURGE_PENDING },
    });

    const due = await photos.findMany({
      where: {
        OR: [
          { status: ProfilePhotoStatus.PURGE_PENDING },
          { status: ProfilePhotoStatus.SUPERSEDED, purgeAfter: { lte: now } },
        ],
      },
    });

    for (const photo of due) {
      try {
        await this.storage.delete(photo.objectKey);
      } catch (error) {
        logStorageFailure(error, 'Profile photo');
        continue;
      }
      await photos.updateMany({
        where: { id: photo.id, status: photo.status },
        data: { status: ProfilePhotoStatus.PURGED, purgedAt: now },
      });
    }
  }
}
