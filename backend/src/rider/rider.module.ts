import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module.js';
import { LicenceImageCleanup } from './licence-image.cleanup.js';
import { LicenceImageController } from './licence-image.controller.js';
import { LicenceImageService } from './licence-image.service.js';
import { MotorcycleController } from './motorcycle.controller.js';
import { MotorcycleReviewController } from './motorcycle-review.controller.js';
import { MotorcycleReviewService } from './motorcycle-review.service.js';
import { MotorcycleService } from './motorcycle.service.js';
import { ObjectStorage } from './object-storage.js';
import { createS3Client, S3_CLIENT_FACTORY, S3ObjectStorage } from './s3-object-storage.js';

@Module({
  imports: [AuthModule, ScheduleModule.forRoot()],
  controllers: [LicenceImageController, MotorcycleController, MotorcycleReviewController],
  providers: [
    LicenceImageService,
    LicenceImageCleanup,
    MotorcycleService,
    MotorcycleReviewService,
    { provide: S3_CLIENT_FACTORY, useValue: createS3Client },
    S3ObjectStorage,
    { provide: ObjectStorage, useExisting: S3ObjectStorage },
  ],
})
export class RiderModule {}
