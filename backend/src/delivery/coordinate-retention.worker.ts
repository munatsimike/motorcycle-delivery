import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CoordinateRetentionService } from './coordinate-retention.service.js';
import { retentionSchedule } from './coordinate-retention.js';

// The API interval stays disabled. The standalone retention process is the
// only scheduler, and it is not started automatically. Do not set
// COORDINATE_RETENTION_ENABLED=true while that process is scheduled.
@Injectable()
export class CoordinateRetentionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly intervalName = 'coordinate-retention';
  private readonly logger = new Logger(CoordinateRetentionWorker.name);

  constructor(
    private readonly retention: CoordinateRetentionService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const schedule = retentionSchedule(process.env);
    if (!schedule.enabled) {
      this.logger.log('Coordinate retention schedule is disabled');
      return;
    }
    const timer = setInterval(() => {
      void this.retention.run().catch((error: unknown) => {
        const name = error instanceof Error ? error.name : 'Error';
        this.logger.error(`Coordinate retention failed: ${name}`);
      });
    }, schedule.intervalMs);
    timer.unref();
    this.scheduler.addInterval(this.intervalName, timer);
    this.logger.log(`Coordinate retention schedule enabled intervalSeconds=${schedule.intervalMs / 1000}`);
  }

  onModuleDestroy(): void {
    if (this.scheduler.doesExist('interval', this.intervalName)) {
      this.scheduler.deleteInterval(this.intervalName);
    }
  }
}
