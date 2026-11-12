import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DISPATCH_POLL_MS } from './dispatch.constants.js';
import { V2OutboxSender } from './v2-outbox-sender.service.js';

@Injectable()
export class V2NoticeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly intervalName = 'v2-customer-notices';
  private readonly logger = new Logger(V2NoticeWorker.name);
  private running = false;

  constructor(
    private readonly notices: V2OutboxSender,
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
      await this.notices.drain(now);
    } catch (error) {
      const name = error instanceof Error ? error.name : 'Error';
      this.logger.error(`V2 notice worker failed: ${name}`);
    } finally {
      this.running = false;
    }
  }
}
