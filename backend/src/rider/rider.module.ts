import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module.js';
import { LicenceImageCleanup } from './licence-image.cleanup.js';
import { LicenceImageController } from './licence-image.controller.js';
import { LicenceImageService } from './licence-image.service.js';
import { LicenceReviewService } from './licence-review.service.js';
import { MotorcycleController } from './motorcycle.controller.js';
import { MotorcycleReviewController } from './motorcycle-review.controller.js';
import { MotorcycleReviewService } from './motorcycle-review.service.js';
import { MotorcycleService } from './motorcycle.service.js';
import { RiderAdminController } from './rider-admin.controller.js';
import { RiderApprovalService } from './rider-approval.service.js';
import { RiderOnboardingController } from './rider-onboarding.controller.js';
import { RiderOnboardingService } from './rider-onboarding.service.js';
import { ObjectStorage } from './object-storage.js';
import { createS3Client, S3_CLIENT_FACTORY, S3ObjectStorage } from './s3-object-storage.js';

@Module({
  imports: [AuthModule, ScheduleModule.forRoot()],
  controllers: [
    LicenceImageController,
    MotorcycleController,
    MotorcycleReviewController,
    RiderAdminController,
    RiderOnboardingController,
  ],
  providers: [
    LicenceImageService,
    LicenceImageCleanup,
    LicenceReviewService,
    MotorcycleService,
    MotorcycleReviewService,
    RiderApprovalService,
    RiderOnboardingService,
    { provide: S3_CLIENT_FACTORY, useValue: createS3Client },
    S3ObjectStorage,
    { provide: ObjectStorage, useExisting: S3ObjectStorage },
  ],
})
export class RiderModule {}
