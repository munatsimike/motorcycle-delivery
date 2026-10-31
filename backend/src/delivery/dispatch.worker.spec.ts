import { describe, expect, it } from 'vitest';
import { DispatchWorker } from './dispatch.worker.js';

describe('DispatchWorker', () => {
  it('expires marketplace searches and does not run V1 recovery, rounds, or retries', async () => {
    const calls: string[] = [];
    const worker = new DispatchWorker({
      async processCreatedRecovery() {
        calls.push('recovery');
        return true;
      },
      async processDueRound() {
        calls.push('round');
        return true;
      },
      async processAutoRetry() {
        calls.push('retry');
        return true;
      },
      async processV2SearchExpiry() {
        calls.push('expiry');
      },
    } as never, {
      addInterval() {},
      deleteInterval() {},
      doesExist() {
        return false;
      },
    } as never);

    await worker.run(new Date('2026-10-30T00:00:00.000Z'));

    expect(calls).toEqual(['expiry']);
  });
});
