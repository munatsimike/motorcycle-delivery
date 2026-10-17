import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { RIDER_ALERT_POLL_MS } from './rider-availability-alert.constants.js';
import { RiderAvailabilityAlertService } from './rider-availability-alert.service.js';

@Injectable()
export class RiderAvailabilityAlertWorker implements OnModuleInit, OnModuleDestroy {
  private readonly intervalName = 'rider-availability-alerts';
  private readonly logger = new Logger(RiderAvailabilityAlertWorker.name);
  private running = false;

  constructor(
    private readonly alerts: RiderAvailabilityAlertService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const timer = setInterval(() => {
      void this.run();
    }, RIDER_ALERT_POLL_MS);
    timer.unref();
    this.scheduler.addInterval(this.intervalName, timer);
  }

  onModuleDestroy(): void {
    if (this.scheduler.doesExist('interval', this.intervalName)) {
      this.scheduler.deleteInterval(this.intervalName);
    }
  }

  async run(now = new Date()): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.alerts.processDue(now);
    } catch (error) {
      const name = error instanceof Error ? error.name : 'Error';
      this.logger.error(`Availability alert worker failed: ${name}`);
    } finally {
      this.running = false;
    }
  }
}
