import { Injectable } from '@nestjs/common';

@Injectable()
export class Clock {
  concealmentMs = 200;

  now(): Date {
    return new Date();
  }

  async pause(ms: number): Promise<void> {
    if (ms <= 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
