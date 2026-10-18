import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CoordinateRetentionService } from './coordinate-retention.service.js';

// Application context for the one-shot retention process. It has no HTTP
// controllers and does not register dispatch or other scheduled workers.
@Module({
  imports: [PrismaModule],
  providers: [CoordinateRetentionService],
})
export class CoordinateRetentionJobModule {}
