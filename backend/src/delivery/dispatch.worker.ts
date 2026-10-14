import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DispatchService } from './dispatch.service.js';
import { DISPATCH_POLL_MS } from './dispatch.constants.js';

@Injectable()
export class DispatchWorker implements OnModuleInit, OnModuleDestroy {
  private readonly intervalName = 'delivery-dispatch';
  private readonly logger = new Logger(DispatchWorker.name);
  private running = false;

  constructor(
    private readonly dispatch: DispatchService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const timer = setInterval(() => {
      void this.run();
    }, DISPATCH_POLL_MS);
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
      for (let processed = 0; processed < 100; processed += 1) {
        const worked = await this.dispatch.processDueRound(now);
        if (!worked) {
          break;
        }
      }

      for (let processed = 0; processed < 100; processed += 1) {
        const worked = await this.dispatch.processAutoRetry(now);
        if (!worked) {
          break;
        }
      }
    } catch (error) {
      const name = error instanceof Error ? error.name : 'Error';
      this.logger.error(`Dispatch worker failed: ${name}`);
    } finally {
      this.running = false;
    }
  }
}

