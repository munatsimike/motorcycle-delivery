import type { GpsFix } from './gpsFix';

export const LOCATION_UPLOAD_INTERVAL_MS = 20_000;

export type UploadOutcome = 'uploaded' | 'waiting' | 'no-fix' | 'failed' | 'joined' | 'paused';

export class SharingPausedError extends Error {
  constructor() {
    super('Location sharing stopped');
    this.name = 'SharingPausedError';
  }
}

export class LocationUploadCoordinator {
  private latest: GpsFix | null = null;
  private tail: Promise<void> | null = null;
  private rerun = false;
  private accepting = false;
  private lastSuccessAt: number | null = null;

  constructor(private readonly clock: () => number = Date.now) {}

  arm(): void {
    this.accepting = true;
  }

  close(): void {
    this.accepting = false;
    this.latest = null;
    this.lastSuccessAt = null;
    this.rerun = false;
  }

  isAccepting(): boolean {
    return this.accepting;
  }

  remember(fix: GpsFix): void {
    if (!this.accepting) {
      return;
    }
    this.latest = fix;
  }

  submit(fix: GpsFix, now: number, send: (fix: GpsFix) => Promise<void>): Promise<UploadOutcome> {
    this.remember(fix);
    return this.flush(now, send);
  }

  flush(now: number, send: (fix: GpsFix) => Promise<void>): Promise<UploadOutcome> {
    if (!this.accepting) {
      return Promise.resolve('paused');
    }
    if (this.tail) {
      this.rerun = true;
      return this.tail.then(() => 'joined' as const);
    }
    const run = this.drain(now, send);
    this.tail = run.then(() => undefined, () => undefined);
    return run.finally(() => {
      this.tail = null;
    });
  }

  private async drain(start: number, send: (fix: GpsFix) => Promise<void>): Promise<UploadOutcome> {
    let now = start;
    let outcome: UploadOutcome = 'waiting';
    do {
      this.rerun = false;
      if (!this.accepting) {
        return 'paused';
      }
      if (!this.latest) {
        return outcome === 'uploaded' ? outcome : 'no-fix';
      }
      if (this.lastSuccessAt !== null && now - this.lastSuccessAt < LOCATION_UPLOAD_INTERVAL_MS) {
        return outcome === 'uploaded' ? outcome : 'waiting';
      }
      const fix = this.latest;
      try {
        await send(fix);
      } catch (error) {
        if (error instanceof SharingPausedError) {
          return 'paused';
        }
        return 'failed';
      }
      if (!this.accepting) {
        return 'paused';
      }
      this.lastSuccessAt = now;
      outcome = 'uploaded';
      now = this.clock();
    } while (this.rerun);
    return outcome;
  }
}
